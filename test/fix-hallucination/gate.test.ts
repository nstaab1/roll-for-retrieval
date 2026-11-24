// The relevance gate on its own: reranked chunks in, answer or not out. These
// tests need no key and no network, and fail on every earlier checkpoint with
// the stub's message.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { passesGate } from "../../src/gate.ts";
import type { Ranked } from "../../src/rerank.ts";
import { requireChoice } from "../require-choice.ts";

describe("your relevance threshold", () => {
  it("is a reranker score", () => {
    const threshold = requireChoice(
      "RELEVANCE_THRESHOLD",
      "fix-hallucination",
      4,
    );
    assert.ok(
      threshold > 0 && threshold < 1,
      "RELEVANCE_THRESHOLD is a reranker score, so it's above 0 and under 1.",
    );
  });
});

// A reranked chunk from a night, with the search's distance and the
// reranker's score.
function chunk(distance: number, score: number): Ranked {
  return {
    night: "barovia-2025-12-01",
    start_ms: 44_750,
    end_ms: 60_000,
    document: null,
    campaign: "barovia",
    visibility: "barovia/party",
    text: "You guys know of Blinsky's Toys.",
    distance,
    score,
  };
}

describe("passesGate", () => {
  it("lets a question through when its best chunk scores at the threshold or above", () => {
    assert.equal(passesGate([chunk(0.5, 0.4), chunk(0.6, 0.01)], 0.4), true);
    assert.equal(passesGate([chunk(0.5, 0.4), chunk(0.6, 0.01)], 0.001), true);
  });

  it("stops a question when even its best chunk scores under the threshold", () => {
    assert.equal(
      passesGate([chunk(0.5, 0.00003), chunk(0.6, 0.00001)], 0.0001),
      false,
    );
  });

  it("reads the reranker's score, never the search's distance", () => {
    // Search put this chunk almost on top of the question, and the reranker
    // says it doesn't answer it.
    assert.equal(passesGate([chunk(0.01, 0.00002)], 0.0001), false);
    // Search put this one far off, and the reranker says it answers it.
    assert.equal(passesGate([chunk(0.9, 0.6)], 0.0001), true);
  });

  it("stops a question nothing was found for", () => {
    assert.equal(passesGate([], 0.0001), false);
  });
});
