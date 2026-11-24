// The shipped eval set: ten questions asked as the player at both tables.
// Seven are one per night, one only the party document answers, and two
// nothing answers. These tests need no key and no network.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { lookUpAsker } from "../../src/ask.ts";
import { loadDocuments } from "../../src/documents.ts";
import { evalSetPath, loadEvalSet } from "../../src/eval.ts";
import { loadNights } from "../../src/nights.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const set = loadEvalSet(evalSetPath());
const nights = loadNights(path.join(repoRoot, "transcripts"), () => {});
const documents = loadDocuments(path.join(repoRoot, "documents"));
const sources = set.questions.map((q) => q.source);

// Each source's visibility: a night's is its campaign's party.
const visibilityOf = new Map<string, string>([
  ...nights.map((n) => [n.id, `${n.campaign}/party`] as const),
  ...documents.map((d) => [d.document, d.visibility] as const),
]);

describe("the eval set", () => {
  it("holds ten questions", () => {
    assert.equal(set.questions.length, 10);
  });

  it("asks one question per night, every night", () => {
    const nightIds = nights.map((n) => n.id).toSorted();
    assert.deepEqual(
      sources.filter((s) => s !== null && nightIds.includes(s)).toSorted(),
      nightIds,
    );
  });

  it("asks one question only a party document answers", () => {
    const fromDocuments = sources.filter(
      (s) => s !== null && documents.some((d) => d.document === s),
    );
    assert.equal(fromDocuments.length, 1, fromDocuments.join(", "));
    assert.match(visibilityOf.get(fromDocuments[0]!)!, /\/party$/);
  });

  it("asks two questions nothing answers", () => {
    assert.equal(sources.filter((s) => s === null).length, 2);
  });

  it("names only real nights and documents as sources", () => {
    for (const source of sources) {
      if (source !== null) {
        assert.ok(
          visibilityOf.has(source),
          `${source} is no night or document`,
        );
      }
    }
  });

  it("asks as a member who may see every expected source, so the leak fix doesn't change the score", () => {
    const { allowed } = lookUpAsker(set.asker);
    for (const source of sources) {
      if (source === null) continue;
      const visibility = visibilityOf.get(source)!;
      assert.ok(
        allowed.includes(visibility),
        `${set.asker} may not see ${source}, which is ${visibility}.`,
      );
    }
  });
});
