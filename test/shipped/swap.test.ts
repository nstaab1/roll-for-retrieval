// The three swaps reach the hosted client: each makes one small real call on
// whatever key is set with the swapped model, for about a tenth of a cent in
// all. The hosted reranker runs on an OpenRouter key; on an OpenAI key the
// eval refuses it and says so. With no key these fail, pointing at .env and
// the doctor script.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { swapProblem } from "../../scripts/eval.ts";
import { swaps } from "../../src/config.ts";
import { readCostLog, type CostLine } from "../../src/cost-log.ts";
import { scoreChunks } from "../../src/cross-encoder.ts";
import { chat, embed, findKey, noKeyMessage } from "../../src/hosted.ts";
import { modelFor, useSwap } from "../../src/swap.ts";

let dir: string;
let savedLog: string | undefined;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "swap-"));
  savedLog = process.env.COST_LOG;
  process.env.COST_LOG = path.join(dir, "cost-log.jsonl");
});

afterEach(() => useSwap(undefined));

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

describe("a swap", () => {
  it("large-embedding embeds with the large model, whose vectors are longer", async () => {
    const [small] = await embed(["the windmill"]);
    useSwap("large-embedding");
    const [large] = await embed(["the windmill"], {
      model: modelFor("embedding"),
    });
    assert.equal(lastLine().model, swaps["large-embedding"].model);
    assert.ok(
      large.length > small.length,
      `${large.length} against ${small.length}`,
    );
  });

  it("newer-answer answers with the newer model and logs its price", async () => {
    useSwap("newer-answer");
    const reply = await chat([
      { role: "user", content: "Reply with the one word: ready" },
    ]);
    assert.ok(reply.trim().length > 0, "The reply has text.");
    const line = lastLine();
    assert.equal(line.stage, "chat");
    assert.equal(line.model, swaps["newer-answer"].model);
    assert.ok(line.dollars > 0);
  });

  it("hosted-reranker scores each chunk on OpenRouter, in order, or is refused on an OpenAI key", async () => {
    const key = findKey();
    assert.ok(key, noKeyMessage);
    if (key.provider === "openai") {
      assert.match(
        swapProblem("hosted-reranker", key)!,
        /runs on OpenRouter only/,
      );
      return;
    }
    useSwap("hosted-reranker");
    const scores = await scoreChunks("What does Blinsky sell?", [
      "The windmill starts to take off in flames.",
      "Blinsky's Toys sells wooden toys and puppets.",
    ]);
    assert.equal(scores.length, 2);
    assert.ok(
      scores[1] > scores[0],
      `the toy shop scored ${scores[1]}, the windmill ${scores[0]}`,
    );
    const line = lastLine();
    assert.equal(line.stage, "reranker");
    assert.equal(line.model, swaps["hosted-reranker"].model);
    assert.ok(line.dollars > 0, "a hosted reranker costs something");
  });
});
