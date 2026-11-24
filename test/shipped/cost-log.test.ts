import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { dollarsFor, readCostLog, runLocal } from "../../src/cost-log.ts";

// Points the cost log at a scratch file for one test, and puts the test-run
// mark back as it was afterwards.
function scratchLog(t: TestContext, testRun: boolean): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cost-log-"));
  const saved = {
    COST_LOG: process.env.COST_LOG,
    COST_LOG_TEST: process.env.COST_LOG_TEST,
  };
  process.env.COST_LOG = path.join(dir, "cost-log.jsonl");
  if (testRun) process.env.COST_LOG_TEST = "1";
  else delete process.env.COST_LOG_TEST;
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return process.env.COST_LOG;
}

describe("pricing a call from the price table", () => {
  it("prices embedding tokens", () => {
    const dollars = dollarsFor("openai/text-embedding-3-small", {
      inputTokens: 1_000_000,
    });
    assert.equal(dollars, 0.02);
  });

  it("prices chat input and output tokens at their own rates", () => {
    const dollars = dollarsFor("openai/gpt-4o-mini", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    assert.equal(dollars, 0.75);
  });

  it("prices hosted transcription by the audio minute", () => {
    const dollars = dollarsFor("openai/gpt-transcribe", { audioSeconds: 120 });
    assert.equal(dollars, 0.009);
  });

  it("refuses a model the price table doesn't list, naming the config", () => {
    assert.throws(() => dollarsFor("openai/gpt-9", { inputTokens: 10 }), {
      message: /openai\/gpt-9.*src\/config\.ts/,
    });
  });

  it("refuses a unit the model has no price for", () => {
    assert.throws(
      () =>
        dollarsFor("openai/text-embedding-3-small", {
          inputTokens: 10,
          audioSeconds: 5,
        }),
      { message: /text-embedding-3-small.*audio/ },
    );
  });
});

describe("a local stage", () => {
  it("returns the work's result and logs one $0 line with stage, model, input size and wall seconds", async (t) => {
    const log = scratchLog(t, false);

    const result = await runLocal(
      "local-transcription",
      "base.en",
      { audioSeconds: 42 },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "the windmill burns";
      },
    );

    assert.equal(result, "the windmill burns");
    const lines = readCostLog(log);
    assert.equal(lines.length, 1);
    const [line] = lines;
    assert.equal(line.stage, "local-transcription");
    assert.equal(line.model, "base.en");
    assert.equal(line.audioSeconds, 42);
    assert.equal(line.dollars, 0);
    assert.ok(line.seconds >= 0.04, `seconds was ${line.seconds}`);
    assert.ok(!Number.isNaN(Date.parse(line.at)), `at was ${line.at}`);
    assert.equal(line.test, undefined);
  });

  it("marks the line as a test call during a test run", async (t) => {
    const log = scratchLog(t, true);

    await runLocal("reranker", "Xenova/ms-marco-MiniLM-L-6-v2", {}, () => 1);

    assert.equal(readCostLog(log)[0].test, true);
  });

  it("logs nothing when the work throws, and passes the error on", async (t) => {
    const log = scratchLog(t, false);

    await assert.rejects(
      runLocal("reranker", "Xenova/ms-marco-MiniLM-L-6-v2", {}, () => {
        throw new Error("model missing");
      }),
      { message: "model missing" },
    );

    assert.deepEqual(readCostLog(log), []);
  });
});
