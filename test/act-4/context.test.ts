// Act 4: context construction. These tests check what your prompt holds,
// never the refusal instruction you wrote. They need no key and no network.
// They fail on the starter with the stub's message.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrompt, answerRules } from "../../src/context.ts";
import type { ChunkRow } from "../../src/store.ts";
import { requireChoice } from "../require-choice.ts";

describe("your refusal instruction", () => {
  it("includes some words", () => {
    const refusal = requireChoice("REFUSAL_INSTRUCTION", "act-4", 4);
    assert.ok(
      refusal.trim().length > 0,
      "REFUSAL_INSTRUCTION is what the model is told, so it needs words.",
    );
  });
});

const chunks: ChunkRow[] = [
  {
    night: "barovia-2025-12-01",
    start_ms: 44_750,
    end_ms: 60_000,
    document: null,
    campaign: "barovia",
    visibility: "barovia/party",
    text: "You guys know of Blinsky's Toys.",
  },
  {
    night: null,
    start_ms: null,
    end_ms: null,
    document: "barovia-strahd-plan",
    campaign: null,
    visibility: "barovia/dm",
    text: "Strahd means to take the burgomaster's daughter.",
  },
  {
    night: "toe-wittine-session-3",
    start_ms: 3_725_000,
    end_ms: 3_760_000,
    document: null,
    campaign: "toe-wittine",
    visibility: "toe-wittine/party",
    text: "Roll initiative.",
  },
];

const question = "What does Blinsky sell?";
const refusal = "If the sources don't say, answer: The game nights don't say.";

// Every message's text, whatever shape its content takes.
function textOf(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

describe("buildPrompt", () => {
  it("puts the rules and your refusal instruction in the system message, first", () => {
    const [first] = buildPrompt(question, chunks, refusal);
    assert.equal(first.role, "system");
    const text = textOf(first.content);
    assert.ok(text.includes(answerRules), "The rules are in it.");
    assert.ok(text.includes(refusal), "Your refusal instruction is in it.");
  });

  it("numbers every chunk from 1 in the order given, with its source and its whole text", () => {
    const messages = buildPrompt(question, chunks, refusal);
    const user = textOf(messages.find((m) => m.role === "user")?.content);
    const labels = [
      "[1] barovia-2025-12-01 at 0:00:44",
      "[2] barovia-strahd-plan",
      "[3] toe-wittine-session-3 at 1:02:05",
    ];
    let from = 0;
    for (const [i, label] of labels.entries()) {
      const at = user.indexOf(label, from);
      assert.ok(at >= from, `Chunk ${i + 1} should be labelled ${label}.`);
      const textAt = user.indexOf(chunks[i].text, at);
      assert.ok(textAt > at, `Chunk ${i + 1}'s text follows its label.`);
      from = textAt;
    }
  });

  it("asks the question after the sources", () => {
    const messages = buildPrompt(question, chunks, refusal);
    const user = textOf(messages.find((m) => m.role === "user")?.content);
    assert.ok(
      user.lastIndexOf(question) > user.indexOf(chunks[2].text),
      "The question comes after the last source.",
    );
  });
});
