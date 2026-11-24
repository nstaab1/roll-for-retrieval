// These tests make real calls on whatever key is set, for well under a cent
// in all. With no key they fail, pointing at .env and the doctor script.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { silentWav } from "../../scripts/doctor.ts";
import { models } from "../../src/config.ts";
import { dollarsFor, readCostLog, type CostLine } from "../../src/cost-log.ts";
import { chat, embed, transcribe } from "../../src/hosted.ts";

const hostedModule = path.resolve(import.meta.dirname, "../../src/hosted.ts");

let dir: string;
let savedLog: string | undefined;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hosted-"));
  savedLog = process.env.COST_LOG;
  process.env.COST_LOG = path.join(dir, "cost-log.jsonl");
});

after(() => {
  if (savedLog === undefined) delete process.env.COST_LOG;
  else process.env.COST_LOG = savedLog;
  rmSync(dir, { recursive: true, force: true });
});

function lastLine(): CostLine {
  const line = readCostLog().at(-1);
  assert.ok(line, "the call wrote no cost log line");
  return line;
}

// The line every hosted call writes: priced from the table, timed, and marked
// as a test call.
function assertLogged(line: CostLine, stage: string, model: string): void {
  assert.equal(line.stage, stage);
  assert.equal(line.model, model);
  assert.equal(line.dollars, dollarsFor(model, line));
  assert.ok(line.dollars > 0, "a hosted call costs something");
  assert.ok(line.seconds > 0);
  assert.equal(line.test, true, "npm test marks its calls");
}

describe("the hosted client", () => {
  it("embeds each text into one vector, in order, and logs the tokens", async () => {
    const vectors = await embed(["the toymaker", "a toy shop in town"]);

    assert.equal(vectors.length, 2);
    assert.ok(vectors[0].length > 0);
    assert.equal(vectors[0].length, vectors[1].length);
    assert.notDeepEqual(vectors[0], vectors[1]);
    const line = lastLine();
    assertLogged(line, "embedding", models.embedding);
    assert.ok(line.inputTokens! > 0);
  });

  it("answers a chat and logs input and output tokens", async () => {
    const reply = await chat(
      [{ role: "user", content: "Reply with the single word: ready" }],
      { max_completion_tokens: 5 },
    );

    assert.equal(typeof reply, "string");
    assert.ok(reply.length > 0);
    const line = lastLine();
    assertLogged(line, "chat", models.answer);
    assert.ok(line.inputTokens! > 0);
    assert.ok(line.outputTokens! > 0);
  });

  it("transcribes an audio file and logs its seconds", async () => {
    const audio = path.join(dir, "one-second.wav");
    writeFileSync(audio, silentWav(1));

    const text = await transcribe(audio);

    assert.equal(typeof text, "string");
    const line = lastLine();
    assertLogged(line, "hosted-transcription", models.hostedTranscription);
    assert.ok(Math.abs(line.audioSeconds! - 1) < 0.05, `${line.audioSeconds}`);
  });

  it("refuses audio over 25 MB before calling anyone", async () => {
    const audio = path.join(dir, "too-long.mp3");
    writeFileSync(audio, "");
    truncateSync(audio, 26_000_000);
    const linesBefore = readCostLog().length;

    await assert.rejects(transcribe(audio), { message: /26\.0 MB.*25 MB/ });

    assert.equal(readCostLog().length, linesBefore);
  });

  it("costs under one cent for the whole file", () => {
    const dollars = readCostLog().reduce((sum, l) => sum + l.dollars, 0);
    assert.ok(dollars < 0.01, `spent $${dollars}`);
  });
});

describe("the hosted client with no key", () => {
  it("fails, pointing at .env and the doctor script", (t) => {
    const empty = mkdtempSync(path.join(tmpdir(), "no-key-"));
    t.after(() => rmSync(empty, { recursive: true, force: true }));
    const { OPENAI_API_KEY, OPENROUTER_API_KEY, ...env } = process.env;

    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const { embed } = await import(${JSON.stringify(hostedModule)}); await embed(["x"]);`,
      ],
      { cwd: empty, env, encoding: "utf8" },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No hosted key\..*\.env.*npm run doctor/);
  });
});
