// The eval through your whole pipeline. It builds the small index from Act 4's
// tests, then asks one question a night answers and one nothing answers, twice
// each, and scores what came back. It runs at a fixed setting, and at yours
// once you've set all four choices. It costs well under a cent, needs a key,
// and fails on the starter with a stub's message.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AskSettings } from "../../src/ask.ts";
import * as choices from "../../src/choices.ts";
import { runEval, scoresOf, type EvalSet } from "../../src/eval.ts";
import { smallIndex } from "../small-index.ts";

const index = smallIndex();

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

const set: EvalSet = {
  asker: "katie",
  questions: [
    { question: "What does Blinsky sell?", source: "barovia-2025-12-01" },
    {
      question: "What did the mayor of Cinder Ward tell the pilgrims?",
      source: null,
    },
  ],
};

describe("the eval", () => {
  for (const settings of settingsToTry) {
    it(`at k ${settings.k}, depth ${settings.depth}, kept ${settings.kept}, asks each question twice, scores every ask, and prices the asks from the cost log`, async (t) => {
      const store = await index.store();
      index.costLog(t);
      const placed: number[] = [];
      const { questions, cost } = await runEval(store, set, settings, {
        runs: 2,
        onQuestion: (_, place) => placed.push(place),
      });

      assert.deepEqual(
        placed,
        [1, 2],
        "The eval reports each question as it finishes, in order.",
      );
      assert.deepEqual(
        questions.map((q) => q.outcomes.length),
        [2, 2],
        "Each question is asked once per run.",
      );
      for (const outcome of questions[0].outcomes) {
        if (settings.depth >= 5) {
          assert.equal(
            outcome.inTop,
            true,
            "The Dec 1 night holds Blinsky's Toys, so it's among the reranker's first 5.",
          );
        }
        assert.equal(
          typeof outcome.cited,
          "boolean",
          "A question with a source is scored cited or not.",
        );
      }
      for (const outcome of questions[1].outcomes) {
        assert.equal(
          outcome.inTop,
          null,
          "A question with no source has no top 5 to be in.",
        );
        assert.equal(
          outcome.cited,
          null,
          "A question with no source has nothing to cite.",
        );
        assert.equal(
          typeof outcome.refused,
          "boolean",
          "A question with no source is scored refused or not.",
        );
      }

      assert.equal(cost.asks, 4, "Two questions, twice each, is 4 asks.");
      assert.ok(
        cost.dollars > 0,
        "The embedding and answer calls cost something.",
      );
      assert.ok(cost.localSeconds > 0, "The local reranker ran.");

      const scores = scoresOf(questions);
      assert.equal(scores.answerable, 1, "One question has a source.");
      assert.equal(scores.unanswerable, 1, "One question has none.");
    });
  }
});
