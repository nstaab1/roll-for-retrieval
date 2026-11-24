// Act 4: ask, the whole pipeline. It builds a small index from the start of
// two real nights and two documents with your code from Acts 2 and 3, then
// asks the Blinsky question through your reranker, prompt and answer call. It
// costs well under a cent, needs a key, and fails on the starter with a
// stub's message.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ask, lookUpAsker, type AskSettings } from "../../src/ask.ts";
import * as choices from "../../src/choices.ts";
import { readCostLog } from "../../src/cost-log.ts";
import { requireChoice } from "../require-choice.ts";
import { smallIndex } from "../small-index.ts";

describe("your chunks kept", () => {
  it("includes a number of chunks", () => {
    const kept = requireChoice("CHUNKS_KEPT", "act-4", 4);
    assert.ok(
      Number.isInteger(kept) && kept > 0,
      "CHUNKS_KEPT counts chunks, so it's a whole number above 0.",
    );
  });
});

// A fixed setting, and yours once all four are set.
const refusal =
  "If the sources don't hold the answer, say you don't know and list no sources.";
const settingsToTry: AskSettings[] = [{ k: 10, depth: 8, kept: 3, refusal }];
const { RETRIEVAL_K, RERANK_DEPTH, CHUNKS_KEPT, REFUSAL_INSTRUCTION } = choices;
if (
  RETRIEVAL_K !== null &&
  RERANK_DEPTH !== null &&
  CHUNKS_KEPT !== null &&
  REFUSAL_INSTRUCTION !== null
) {
  settingsToTry.unshift({
    k: RETRIEVAL_K,
    depth: RERANK_DEPTH,
    kept: CHUNKS_KEPT,
    refusal: REFUSAL_INSTRUCTION,
  });
}

const index = smallIndex();

const blinsky = "What does Blinsky sell?";

describe("ask", () => {
  for (const settings of settingsToTry) {
    it(`at k ${settings.k}, depth ${settings.depth}, kept ${settings.kept}, answers the Blinsky question citing a Barovia night it kept`, async () => {
      const asked = await ask(
        await index.store(),
        blinsky,
        settings,
        lookUpAsker("katie"),
      );
      assert.ok(asked.text.trim().length > 0, "The answer has text.");
      assert.ok(
        asked.citations.some(
          (c) => "night" in c && c.night.startsWith("barovia-"),
        ),
        `Cited ${JSON.stringify(asked.citations)} for: ${asked.text}`,
      );

      assert.ok(asked.kept.length <= settings.kept);
      for (const [i, chunk] of asked.kept.entries()) {
        if (i > 0) assert.ok(chunk.score <= asked.kept[i - 1].score);
      }
      for (const citation of asked.citations) {
        assert.ok(
          asked.kept.some((chunk) =>
            "night" in citation
              ? chunk.night === citation.night &&
                chunk.start_ms === citation.start_ms
              : chunk.document === citation.document,
          ),
          `${JSON.stringify(citation)} isn't a chunk the prompt held.`,
        );
      }
    });
  }

  it("carries the asker, embeds once, reranks locally and makes one answer call", async (t) => {
    const store = await index.store();
    const costLog = index.costLog(t);
    const asked = await ask(
      store,
      blinsky,
      settingsToTry.at(-1)!,
      lookUpAsker("katie"),
    );
    assert.deepEqual(asked.asker, {
      name: "katie",
      allowed: ["barovia/party", "toe-wittine/party"],
    });
    const stages = readCostLog(costLog).map((line) => line.stage);
    assert.equal(stages.filter((s) => s === "embedding").length, 1);
    assert.ok(stages.includes("reranker"), stages.join(", "));
    assert.equal(stages.filter((s) => s === "chat").length, 1);
  });
});
