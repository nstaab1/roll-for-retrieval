// Act 1: the hosted transcription call. These tests make two real calls on
// fifteen seconds of the windmill clip, for well under a cent, so they need
// a key and the fetched clips. They fail on the starter with the stub's
// message.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { models } from "../../src/config.ts";
import { dollarsFor, readCostLog } from "../../src/cost-log.ts";
import { transcribeHosted } from "../../src/transcribe-hosted.ts";
import { readHosted, transcriptPaths } from "../../src/transcript.ts";
import { cutSeconds, fifteenSecondsOfWindmill } from "../windmill.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const script = path.join(repoRoot, "scripts/transcribe-hosted.ts");

// A scratch folder with its own cost log. Returns the path the audio file
// named will have in it.
function scratch(t: TestContext, audio: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hosted-transcription-"));
  const saved = process.env.COST_LOG;
  process.env.COST_LOG = path.join(dir, "cost-log.jsonl");
  t.after(() => {
    if (saved === undefined) delete process.env.COST_LOG;
    else process.env.COST_LOG = saved;
    rmSync(dir, { recursive: true, force: true });
  });
  return path.join(dir, audio);
}

describe("hosted transcription", () => {
  it("transcribes the clip through the shipped client and writes its text, wall time and dollars beside it", async (t) => {
    const audio = scratch(t, "windmill-fifteen-seconds.mp3");
    fifteenSecondsOfWindmill(audio);

    const returned = await transcribeHosted(audio);

    const written = readHosted(transcriptPaths(audio).hosted);
    assert.deepEqual(written, returned);
    assert.equal(written.source, "windmill-fifteen-seconds.mp3");
    assert.equal(written.model, models.hostedTranscription);
    assert.ok(
      Math.abs(written.audioSeconds - cutSeconds) < 0.5,
      `${written.audioSeconds}`,
    );
    assert.ok(written.wallSeconds > 0);
    assert.equal(
      written.dollars,
      dollarsFor(models.hostedTranscription, {
        audioSeconds: written.audioSeconds,
      }),
      "priced from the table, like the cost log",
    );
    assert.equal(typeof written.text, "string");
    assert.ok(written.text.length > 0, "no text came back");
    assert.ok(
      !("transcription" in written) && !existsSync(transcriptPaths(audio).meta),
      "hosted output has no segments and no meta file, so the vector store can't load it",
    );
    const line = readCostLog().at(-1);
    assert.ok(line, "the call wrote no cost log line");
    assert.equal(line.stage, "hosted-transcription");
    assert.equal(line.dollars, written.dollars);
  });

  it("refuses a file over 25 MB with a clear message, before calling anyone", async (t) => {
    const audio = scratch(t, "too-long.mp3");
    writeFileSync(audio, "");
    truncateSync(audio, 26_000_000);

    // Checked this way so the starter's stub message is the failure's message.
    await assert.rejects(transcribeHosted(audio), (error: Error) => {
      assert.match(error.message, /26\.0 MB.*25 MB/, error.message);
      return true;
    });

    assert.ok(
      !existsSync(transcriptPaths(audio).hosted),
      "wrote a file anyway",
    );
    assert.deepEqual(readCostLog(), []);
  });

  it("runs from npm run transcribe:hosted and says what it wrote", (t) => {
    const audio = scratch(t, "windmill-fifteen-seconds.mp3");
    fifteenSecondsOfWindmill(audio);

    // From the repo root, where npm runs it and where .env is.
    const result = spawnSync(process.execPath, [script, audio], {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Wrote .*windmill-fifteen-seconds\.hosted\.json in \d+ s for \$0\.00\d/,
    );
    assert.ok(
      readFileSync(transcriptPaths(audio).hosted, "utf8").includes('"text"'),
    );
  });
});
