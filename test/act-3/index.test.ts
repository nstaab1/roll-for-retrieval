// Act 3: embed, index and search. These tests check the shape of what your code
// stores and returns, never the k you chose. They make real embedding calls on
// a few short texts, for well under a cent, so they need a key. They fail on
// the starter with the stub's message.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { RETRIEVAL_K } from "../../src/choices.ts";
import { models, swaps } from "../../src/config.ts";
import { readCostLog } from "../../src/cost-log.ts";
import { embedBatchSize, embedChunks } from "../../src/embed.ts";
import { search } from "../../src/search.ts";
import {
  countChunks,
  createStore,
  indexChunks,
  type ChunkRow,
  type EmbeddedChunk,
  type IndexSettings,
  type Store,
} from "../../src/store.ts";
import { requireChoice } from "../require-choice.ts";

describe("your retrieval choice", () => {
  it("includes a k", () => {
    const k = requireChoice("RETRIEVAL_K", "act-3", 4);
    assert.ok(
      Number.isInteger(k) && k > 0,
      "RETRIEVAL_K counts chunks, so it's a whole number above 0.",
    );
  });
});

function nightRow(night: string, startMs: number, text: string): ChunkRow {
  const campaign = night.startsWith("barovia") ? "barovia" : "toe-wittine";
  return {
    night,
    start_ms: startMs,
    end_ms: startMs + 20_000,
    document: null,
    campaign,
    visibility: `${campaign}/party`,
    text,
  };
}

function documentRow(
  document: string,
  visibility: string,
  text: string,
): ChunkRow {
  return {
    night: null,
    start_ms: null,
    end_ms: null,
    document,
    campaign: null,
    visibility,
    text,
  };
}

// Five chunks about five different things, from both campaigns, nights and
// documents.
const rows: ChunkRow[] = [
  nightRow(
    "barovia-2026-01-07",
    731_320,
    "You start the fire. Morgantha's body starts to burn up. The windmill starts to take off in flames.",
  ),
  nightRow(
    "barovia-2025-12-01",
    44_000,
    "You guys know of Blinsky's Toys. Wooden dolls and puppets fill the shop window.",
  ),
  nightRow(
    "toe-wittine-session-3",
    1_200_000,
    "Roll initiative. The goblins burst out of the hedge with spears.",
  ),
  documentRow(
    "toe-wittine-briar-secret",
    "toe-wittine/dm",
    "Elder Briar keeps the ember ward lit with a stolen heartstone.",
  ),
  documentRow(
    "barovia-strahd-plan",
    "barovia/dm",
    "Strahd means to take the burgomaster's daughter before the next full moon.",
  ),
];

// A cost log of the test's own, so it can count the calls its code made.
function scratchCostLog(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "act-3-"));
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

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / Math.sqrt(aa * bb);
}

describe("embedChunks", () => {
  it("gives every chunk one vector and keeps everything else it carries", async () => {
    const embedded = await embedChunks(rows, models.embedding);
    assert.equal(embedded.length, rows.length);
    for (const [i, { embedding, ...rest }] of embedded.entries()) {
      assert.deepEqual(
        rest,
        rows[i],
        `Chunk ${i + 1} came back changed or out of order. Act 4 cites its night or document, and the last hour filters on its visibility.`,
      );
      assert.ok(Array.isArray(embedding) && embedding.length > 0);
      assert.equal(embedding.length, embedded[0].embedding.length);
    }
  });

  it("sends more chunks than one request carries in batches, and keeps their order", async (t) => {
    const costLog = scratchCostLog(t);
    const many = Array.from({ length: embedBatchSize + 4 }, (_, i) =>
      nightRow(
        "barovia-2025-12-23",
        i * 1000,
        i % 2 === 0 ? "The windmill burns." : "Roll for initiative.",
      ),
    );

    const embedded = await embedChunks(many, models.embedding);

    assert.equal(embedded.length, many.length);
    const calls = readCostLog(costLog).filter((l) => l.stage === "embedding");
    assert.equal(
      calls.length,
      2,
      `${many.length} chunks at ${embedBatchSize} a request is 2 requests.`,
    );
    const [even, odd] = [embedded[0].embedding, embedded[1].embedding];
    for (const [i, chunk] of embedded.entries()) {
      const same = i % 2 === 0 ? even : odd;
      const other = i % 2 === 0 ? odd : even;
      assert.ok(
        cosine(chunk.embedding, same) > cosine(chunk.embedding, other),
        `Chunk ${i + 1} has another chunk's vector. Each vector belongs to the text at its place in the batch.`,
      );
      assert.equal(chunk.start_ms, i * 1000, `Chunk ${i + 1} is out of order.`);
    }
  });

  it("embeds with the model it's given", async () => {
    const large = swaps["large-embedding"].model;
    const [small] = await embedChunks(rows.slice(0, 1), models.embedding);
    const [big] = await embedChunks(rows.slice(0, 1), large);
    assert.notEqual(
      big.embedding.length,
      small.embedding.length,
      `${large} writes longer vectors than ${models.embedding}.`,
    );
  });
});

const settings: IndexSettings = {
  chunkSize: 600,
  chunkOverlap: 1,
  model: models.embedding,
};

// An empty store that closes when the test ends, so the test run can exit.
async function emptyStore(
  t: TestContext,
  at: IndexSettings = settings,
): Promise<Store> {
  const store = await createStore(at);
  t.after(() => store.db.close());
  return store;
}

describe("indexChunks", () => {
  it("stores every chunk as a row, with every field and its vector", async (t) => {
    const store = await emptyStore(t);
    const embedded: EmbeddedChunk[] = rows.map((row, i) => ({
      ...row,
      embedding: [i, 1, 0.5],
    }));

    await indexChunks(store, embedded);

    const { rows: stored } = await store.db.query<
      ChunkRow & { embedding: string }
    >(
      "SELECT night, start_ms, end_ms, document, campaign, visibility, text, embedding::text FROM chunks ORDER BY id",
    );
    assert.deepEqual(
      stored,
      embedded.map((chunk) => ({
        ...chunk,
        embedding: JSON.stringify(chunk.embedding),
      })),
    );
  });
});

// A store holding `rows`, embedded with the settings' model by your code.
async function storeOf(t: TestContext, at: IndexSettings = settings) {
  const store = await emptyStore(t, at);
  await indexChunks(store, await embedChunks(rows, at.model));
  return store;
}

const ks = [1, 3, 5, 10];
if (RETRIEVAL_K !== null && !ks.includes(RETRIEVAL_K)) ks.unshift(RETRIEVAL_K);

describe("search", () => {
  for (const k of ks) {
    it(`at k ${k}, returns the ${k} nearest chunks, nearest first, each with all it carries`, async (t) => {
      const store = await storeOf(t);
      const hits = await search(store, "How did the windmill burn?", k);

      assert.equal(hits.length, Math.min(k, rows.length));
      assert.equal(
        hits[0].night,
        "barovia-2026-01-07",
        "The windmill chunk should be nearest the windmill question.",
      );
      for (const [i, hit] of hits.entries()) {
        assert.equal(typeof hit.distance, "number", "Each hit has a distance.");
        if (i > 0) {
          assert.ok(
            hit.distance >= hits[i - 1].distance,
            `Hit ${i + 1} is nearer than hit ${i}. Nearest comes first.`,
          );
        }
        const { distance, ...row } = hit;
        assert.ok(
          rows.some((r) => isDeepStrictEqual(r, row)),
          `Hit ${i + 1} doesn't carry all its chunk's fields: ${JSON.stringify(row)}`,
        );
      }
    });
  }

  it("finds a DM document as easily as a night, since nothing filters yet", async (t) => {
    const store = await storeOf(t);
    const [hit] = await search(
      store,
      "What is Elder Briar hiding about the ember ward?",
      1,
    );
    assert.equal(hit.document, "toe-wittine-briar-secret");
    assert.equal(hit.visibility, "toe-wittine/dm");
  });

  it("embeds the question with the model the index was built with", async (t) => {
    const large = swaps["large-embedding"].model;
    const store = await storeOf(t, { ...settings, model: large });
    assert.equal(await countChunks(store), rows.length);
    const [hit] = await search(store, "Who sells toys in town?", 1);
    assert.equal(hit.night, "barovia-2025-12-01");
  });
});
