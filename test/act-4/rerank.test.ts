// Act 4: the reranker. These tests check the shape of what your reranker
// returns, never the depth you chose. They run the local reranker model on a
// few short chunks, with no key and no network. They fail on the starter with
// the stub's message.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RERANK_DEPTH } from "../../src/choices.ts";
import { rerank } from "../../src/rerank.ts";
import type { Hit } from "../../src/store.ts";
import { requireChoice } from "../require-choice.ts";

describe("your rerank depth", () => {
  it("includes a depth", () => {
    const depth = requireChoice("RERANK_DEPTH", "act-4", 4);
    assert.ok(
      Number.isInteger(depth) && depth > 0,
      "RERANK_DEPTH counts chunks, so it's a whole number above 0.",
    );
  });
});

// A night's hit at `distance`, its moment made from the distance.
function hit(night: string, distance: number, text: string): Hit {
  const campaign = night.startsWith("barovia") ? "barovia" : "toe-wittine";
  return {
    night,
    start_ms: Math.round(distance * 100_000),
    end_ms: Math.round(distance * 100_000) + 20_000,
    document: null,
    campaign,
    visibility: `${campaign}/party`,
    text,
    distance,
  };
}

const question = "What does Blinsky sell?";
const answers = hit(
  "barovia-2025-12-01",
  0.5,
  "You guys know of Blinsky's Toys. Wooden dolls and puppets fill the shop window.",
);
// Nearest first, as search returns them, with the chunk that answers third.
const hits: Hit[] = [
  hit(
    "barovia-2025-12-23",
    0.3,
    "So you guys plan on heading to Blinsky's? It's in the town square.",
  ),
  hit(
    "toe-wittine-session-3",
    0.4,
    "Roll initiative. The goblins burst out of the hedge with spears.",
  ),
  answers,
  hit(
    "barovia-2026-01-07",
    0.6,
    "You start the fire. The windmill starts to take off in flames.",
  ),
  hit(
    "toe-wittine-session-1",
    0.7,
    "We over-packed a little bit for the trip to the ember ward.",
  ),
];

const depths = [1, 3, 5];
if (RERANK_DEPTH !== null && !depths.includes(RERANK_DEPTH)) {
  depths.unshift(RERANK_DEPTH);
}

describe("rerank", () => {
  for (const depth of depths) {
    it(`at depth ${depth}, scores the first ${depth} hits and returns them best first, each with all it carries`, async () => {
      const ranked = await rerank(question, hits, depth);

      assert.equal(ranked.length, Math.min(depth, hits.length));
      const scored = hits.slice(0, depth);
      for (const [i, { score, ...rest }] of ranked.entries()) {
        assert.equal(typeof score, "number", "Each chunk carries its score.");
        assert.ok(score >= 0 && score <= 1, `Score ${score} is not 0 to 1.`);
        if (i > 0) {
          assert.ok(
            score <= ranked[i - 1].score,
            `Chunk ${i + 1} scores higher than chunk ${i}. Best comes first.`,
          );
        }
        assert.ok(
          scored.some((h) => JSON.stringify(h) === JSON.stringify(rest)),
          `Chunk ${i + 1} isn't one of the first ${depth} hits, whole: ${JSON.stringify(rest)}`,
        );
      }
    });
  }

  it("puts the chunk that answers the question first, though search ranked it third", async () => {
    const [best] = await rerank(question, hits, hits.length);
    assert.equal(best.text, answers.text);
  });

  it("never sees a hit past the depth, however well it would score", async () => {
    const ranked = await rerank(question, hits, 2);
    assert.ok(
      ranked.every((r) => r.text !== answers.text),
      "The answering chunk is third, so a depth of 2 never scores it.",
    );
  });
});
