// The access filter for every member of members.json, at both campaigns. It
// builds the small index from Act 4, which holds both campaigns' nights and a
// DM document from each, and asks for every chunk in it as each member. Only
// chunks the member may see come back, and all of them do. It embeds the
// small index and one question per member, for well under a cent, and needs a
// key.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchVisible } from "../../src/access.ts";
import { lookUpAsker } from "../../src/ask.ts";
import { loadMembers, membersPath } from "../../src/members.ts";
import { countChunks, type Store } from "../../src/store.ts";
import { smallIndex } from "../small-index.ts";

const question = "What does Blinsky sell?";

const index = smallIndex();

// How many chunks in the store carry one of `allowed`.
async function countVisible(store: Store, allowed: string[]): Promise<number> {
  const { rows } = await store.db.query<{ visibility: string }>(
    "SELECT visibility FROM chunks",
  );
  return rows.filter((row) => allowed.includes(row.visibility)).length;
}

describe("the access filter", () => {
  it("gives every member only the chunks their visibilities allow, and every one of those", async () => {
    const store = await index.store();
    const everyChunk = await countChunks(store);
    for (const name of loadMembers(membersPath()).keys()) {
      const { allowed } = lookUpAsker(name);
      const hits = await searchVisible(store, question, everyChunk, allowed);
      for (const hit of hits) {
        assert.ok(
          allowed.includes(hit.visibility),
          `${name} may see ${allowed.join(", ")}, and a ${hit.visibility} chunk came back.`,
        );
      }
      assert.equal(
        hits.length,
        await countVisible(store, allowed),
        `${name} may see ${allowed.join(", ")}, so every chunk carrying one of those comes back when k covers the store.`,
      );
    }
  });

  it("gives a member the file doesn't know nothing at all", async () => {
    const store = await index.store();
    const hits = await searchVisible(
      store,
      question,
      await countChunks(store),
      // Strahd sits at no table, so the file doesn't list him.
      lookUpAsker("strahd").allowed,
    );
    assert.deepEqual(
      hits.map((hit) => hit.visibility),
      [],
      "An unknown member is allowed nothing, so no chunk comes back.",
    );
  });
});
