// Why the access filter goes in the query. A store with six of the DM's chunks
// nearest the question shows the other two places failing: filtered after
// search, a player keeps 2 of their 8 chunks, and filtered on the answer, the
// model has already read the secret. Then your filter, in the query, has to
// do better at both. These embed the question and make one answer call, for
// well under a cent, and need a key.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchVisible } from "../../src/access.ts";
import { ask, lookUpAsker, type AskSettings } from "../../src/ask.ts";
import { buildPrompt } from "../../src/context.ts";
import { rerank } from "../../src/rerank.ts";
import { search } from "../../src/search.ts";
import {
  dmNearest,
  k,
  placedIndex,
  question,
  secret,
} from "../placed-index.ts";

// A Barovia player, and a fixed setting for the whole pipeline.
const player = lookUpAsker("scott");
const settings: AskSettings = {
  k,
  depth: k,
  kept: 4,
  refusal:
    "If the sources don't hold the answer, say you don't know and list no sources.",
};

const index = placedIndex();

const mayRead = (visibility: string) => player.allowed.includes(visibility);

describe("where the access filter goes", () => {
  it(`after search, leaves a player ${k - dmNearest} of their ${k} chunks; in the query, all ${k}`, async () => {
    const store = await index.store();
    const afterSearch = (await search(store, question, k)).filter((hit) =>
      mayRead(hit.visibility),
    );
    assert.equal(
      afterSearch.length,
      k - dmNearest,
      `Search's ${k} nearest hold ${dmNearest} DM chunks, so filtering after it leaves ${k - dmNearest}.`,
    );

    const inQuery = await searchVisible(store, question, k, player.allowed);
    for (const hit of inQuery) {
      assert.ok(
        mayRead(hit.visibility),
        `A ${hit.visibility} chunk came back for a player who may see ${player.allowed.join(", ")}. The filter belongs inside the query.`,
      );
    }
    assert.equal(
      inQuery.length,
      k,
      `Filtered in the query, top-k counts only chunks the player may see, so all ${k} are theirs.`,
    );
  });

  it("on the answer, comes after the model has read the secret; in the query, the prompt never holds it", async () => {
    const store = await index.store();
    const ranked = await rerank(
      question,
      await search(store, question, settings.k),
      settings.depth,
    );
    const prompt = buildPrompt(
      question,
      ranked.slice(0, settings.kept),
      settings.refusal,
    );
    assert.ok(
      prompt.some((message) => String(message.content).includes(secret)),
      "With no filter before the prompt, the secret is in it, so the model has read it before any filter on its answer runs.",
    );

    const asked = await ask(store, question, settings, player);
    for (const chunk of asked.kept) {
      assert.ok(
        mayRead(chunk.visibility),
        `The prompt held a ${chunk.visibility} chunk for a player who may see ${player.allowed.join(", ")}.`,
      );
    }
    assert.ok(
      !asked.text.toLowerCase().includes(secret),
      `The answer gave a player the DM's secret: ${asked.text}`,
    );
  });
});
