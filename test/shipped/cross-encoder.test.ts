// The local reranker model the Act 4 reranker calls. It runs from the
// workshop image's cache with no key and no network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { readCostLog } from "../../src/cost-log.ts";
import { scoreBatchSize, scoreChunks } from "../../src/cross-encoder.ts";
import { reranker } from "../../src/local-models.ts";

// A cost log of the test's own, so it can read the lines the client wrote.
function scratchCostLog(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cross-encoder-"));
  const saved = process.env.COST_LOG;
  const file = path.join(dir, "cost-log.jsonl");
  process.env.COST_LOG = file;
  t.after(() => {
    if (saved === undefined) delete process.env.COST_LOG;
    else process.env.COST_LOG = saved;
    rmSync(dir, { recursive: true, force: true });
  });
  return file;
}

const question = "What does Blinsky sell?";
const answers =
  "You guys know of Blinsky's Toys. Wooden dolls fill the window.";
const missesIt = "Roll initiative. The goblins burst out of the hedge.";

describe("scoreChunks", () => {
  it("scores a chunk that answers the question above one that doesn't, each from 0 to 1", async () => {
    const [hit, miss] = await scoreChunks(question, [answers, missesIt]);
    assert.ok(hit > miss, `${hit} should beat ${miss}`);
    for (const score of [hit, miss]) assert.ok(score >= 0 && score <= 1);
  });

  it("gives one score per text, in the order given, across batches", async () => {
    const texts = Array.from({ length: scoreBatchSize + 3 }, (_, i) =>
      i % 2 === 0 ? answers : missesIt,
    );
    const scores = await scoreChunks(question, texts);
    assert.equal(scores.length, texts.length);
    for (const [i, score] of scores.entries()) {
      const twin = scores[i % 2];
      assert.ok(
        Math.abs(score - twin) < 1e-6,
        `Text ${i + 1} got another text's score.`,
      );
    }
  });

  it("writes one reranker line to the cost log at $0, with the tokens it read", async (t) => {
    const costLog = scratchCostLog(t);
    await scoreChunks(question, [answers, missesIt]);
    const lines = readCostLog(costLog);
    assert.equal(lines.length, 1);
    const [line] = lines;
    assert.equal(line.stage, "reranker");
    assert.equal(line.model, reranker.id);
    assert.equal(line.dollars, 0);
    assert.ok(line.inputTokens! > 10, `${line.inputTokens} tokens`);
  });

  it("scores nothing, and logs nothing, when there's nothing to score", async (t) => {
    const costLog = scratchCostLog(t);
    assert.deepEqual(await scoreChunks(question, []), []);
    assert.deepEqual(readCostLog(costLog), []);
  });
});
