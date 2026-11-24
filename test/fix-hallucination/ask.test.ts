// The relevance gate inside ask. Madam Eva never sat at either table, so no
// chunk answers a question about her, and a gated ask must answer "I don't
// know" without calling the model. The Blinsky question still gets through.
// These build the small index and make one answer call, for well under a
// cent, and need a key.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ask, lookUpAsker, type AskSettings } from "../../src/ask.ts";
import { readCostLog } from "../../src/cost-log.ts";
import { dontKnow } from "../../src/gate.ts";
import { smallIndex } from "../small-index.ts";

// A fixed setting with the gate on.
const settings: AskSettings = {
  k: 10,
  depth: 8,
  kept: 3,
  refusal:
    "If the sources don't hold the answer, say you don't know and list no sources.",
  threshold: 0.0001,
};

const index = smallIndex();

describe("ask, through the relevance gate", () => {
  it("answers the Madam Eva question with I don't know, citing nothing, and writes no chat line to the cost log", async (t) => {
    const store = await index.store();
    const costLog = index.costLog(t);
    const asked = await ask(
      store,
      "What did Madam Eva read in the cards?",
      settings,
      lookUpAsker("katie"),
    );
    assert.equal(asked.gated, true, `Best score ${asked.kept[0]?.score}.`);
    assert.equal(asked.text, dontKnow);
    assert.deepEqual(asked.citations, []);
    const stages = readCostLog(costLog).map((line) => line.stage);
    assert.ok(stages.includes("reranker"), stages.join(", "));
    assert.equal(stages.filter((s) => s === "chat").length, 0);
  });

  it("lets the Blinsky question through to one answer call", async (t) => {
    const store = await index.store();
    const costLog = index.costLog(t);
    const asked = await ask(
      store,
      "What does Blinsky sell?",
      settings,
      lookUpAsker("katie"),
    );
    assert.equal(asked.gated, false, `Best score ${asked.kept[0]?.score}.`);
    assert.ok(asked.text.trim().length > 0, "The answer has text.");
    const stages = readCostLog(costLog).map((line) => line.stage);
    assert.equal(stages.filter((s) => s === "chat").length, 1);
  });
});
