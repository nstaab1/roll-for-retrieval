// Act 4: the answer call. These tests check the shape of the answer and its
// citations, never its wording. They make a few real answer calls on short
// prompts, for well under a cent, so they need a key. They fail on the
// starter with the stub's message.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { generateAnswer } from "../../src/answer.ts";
import { citationOf, type Citation } from "../../src/citation.ts";
import { models } from "../../src/config.ts";
import { buildPrompt } from "../../src/context.ts";
import { readCostLog } from "../../src/cost-log.ts";
import type { ChunkRow } from "../../src/store.ts";

// A cost log of the test's own, so it can count the calls its code made.
function scratchCostLog(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "act-4-"));
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

const chunks: ChunkRow[] = [
  {
    night: "toe-wittine-session-3",
    start_ms: 1_200_000,
    end_ms: 1_230_000,
    document: null,
    campaign: "toe-wittine",
    visibility: "toe-wittine/party",
    text: "Roll initiative. The goblins burst out of the hedge with spears.",
  },
  {
    night: "barovia-2025-12-01",
    start_ms: 44_750,
    end_ms: 60_000,
    document: null,
    campaign: "barovia",
    visibility: "barovia/party",
    text: "You guys know of Blinsky's Toys. Wooden dolls and puppets fill the shop window.",
  },
  {
    night: null,
    start_ms: null,
    end_ms: null,
    document: "barovia-strahd-plan",
    campaign: null,
    visibility: "barovia/dm",
    text: "Strahd means to take the burgomaster's daughter before the next full moon.",
  },
];

// A fixed refusal instruction, so the tests never depend on yours.
const refusal =
  "If the sources don't hold the answer, say you don't know and list no sources.";

// Every citation is one of the chunks', and carries only what a citation
// carries.
function assertCitesOnly(citations: Citation[], from: ChunkRow[]) {
  const allowed = from.map((chunk) => JSON.stringify(citationOf(chunk)));
  for (const citation of citations) {
    assert.ok(
      allowed.includes(JSON.stringify(citation)),
      `${JSON.stringify(citation)} isn't the citation of a chunk in the prompt.`,
    );
  }
}

// Your prompt and answer call on the three chunks, at the fixed refusal.
async function answerFrom(question: string) {
  return generateAnswer(buildPrompt(question, chunks, refusal), chunks);
}

describe("generateAnswer", () => {
  it("answers, and cites the night and moment of the chunk the answer came from", async () => {
    const answer = await answerFrom("What does Blinsky sell?");
    assert.equal(typeof answer.text, "string");
    assert.ok(answer.text.trim().length > 0, "The answer has text.");
    assert.deepEqual(
      answer.citations.filter((c) => "night" in c),
      [{ night: "barovia-2025-12-01", start_ms: 44_750 }],
      "The toy shop is in the Dec 1 chunk, at 0:00:44.",
    );
    assertCitesOnly(answer.citations, chunks);
  });

  it("cites a document by its name", async () => {
    const answer = await answerFrom(
      "What does Strahd mean to do with the burgomaster's daughter?",
    );
    assert.ok(
      answer.citations.some(
        (c) => "document" in c && c.document === "barovia-strahd-plan",
      ),
      `Cited ${JSON.stringify(answer.citations)}`,
    );
    assertCitesOnly(answer.citations, chunks);
  });

  it("makes one answer call with the workshop's answer model", async (t) => {
    const costLog = scratchCostLog(t);
    await answerFrom("What does Blinsky sell?");
    const calls = readCostLog(costLog);
    assert.deepEqual(
      calls.map((c) => [c.stage, c.model]),
      [["chat", models.answer]],
    );
  });
});
