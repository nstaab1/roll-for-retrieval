// The vector store: its table, saving and opening an index with the values it
// was built at, and finding which index to search. These tests need no key and
// no network: they write rows with made-up three-number vectors.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import {
  countChunks,
  createStore,
  findIndex,
  indexPaths,
  openStore,
  rowFromChunk,
  rowFromDocument,
  saveStore,
  toVector,
  type IndexSettings,
  type Store,
} from "../../src/store.ts";

const settings: IndexSettings = {
  chunkSize: 300,
  chunkOverlap: 2,
  model: "openai/text-embedding-3-small",
};

function scratch(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A store that closes when the test ends, so the test run can exit.
async function closedAfter(t: TestContext, store: Promise<Store>) {
  const opened = await store;
  t.after(() => opened.db.close());
  return opened;
}

describe("createStore", () => {
  it("has a chunks table whose visibility column can't be left empty", async (t) => {
    const store = await closedAfter(t, createStore(settings));
    const { rows } = await store.db.query<{
      column_name: string;
      is_nullable: string;
    }>(
      "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'chunks'",
    );
    const visibility = rows.find((row) => row.column_name === "visibility");
    assert.equal(visibility?.is_nullable, "NO");
    await assert.rejects(
      store.db.query(
        "INSERT INTO chunks (text, embedding) VALUES ('no visibility', '[1,0,0]')",
      ),
      /visibility/,
    );
  });

  it("measures distance with pgvector's <=>", async (t) => {
    const store = await closedAfter(t, createStore(settings));
    const { rows } = await store.db.query<{ distance: number }>(
      "SELECT $1::vector <=> $2::vector AS distance",
      [toVector([1, 0, 0]), toVector([0, 1, 0])],
    );
    assert.equal(rows[0].distance, 1);
  });
});

describe("saveStore and openStore", () => {
  it("keep every row and the values the index was built at", async (t) => {
    const file = path.join(scratch(t), "index", "built.tar.gz");
    const store = await closedAfter(t, createStore(settings));
    await store.db.query(
      "INSERT INTO chunks (night, start_ms, end_ms, campaign, visibility, text, embedding) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [
        "barovia-2026-01-07",
        731_320,
        735_000,
        "barovia",
        "barovia/party",
        "The windmill starts to take off in flames.",
        toVector([0.1, 0.2, 0.3]),
      ],
    );
    await saveStore(store, file);

    const opened = await closedAfter(t, openStore(file));
    assert.deepEqual(opened.settings, settings);
    assert.equal(await countChunks(opened), 1);
    const { rows } = await opened.db.query<{
      night: string;
      visibility: string;
      embedding: string;
    }>("SELECT night, visibility, embedding::text FROM chunks");
    assert.deepEqual(rows, [
      {
        night: "barovia-2026-01-07",
        visibility: "barovia/party",
        embedding: "[0.1,0.2,0.3]",
      },
    ]);
  });
});

describe("findIndex", () => {
  function place(root: string, file: string) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), "");
  }

  it("picks yours once npm run ingest has built it", (t) => {
    const root = scratch(t);
    place(root, indexPaths.shipped);
    place(root, indexPaths.yours);
    assert.equal(findIndex(root), path.join(root, indexPaths.yours));
  });

  it("picks the shipped one until then", (t) => {
    const root = scratch(t);
    place(root, indexPaths.shipped);
    assert.equal(findIndex(root), path.join(root, indexPaths.shipped));
  });

  it("names both ways to get an index when there is none", (t) => {
    assert.throws(
      () => findIndex(scratch(t)),
      /npm run ingest.*npm run catch-up -- 3/,
    );
  });
});

describe("a chunk as a row", () => {
  it("keeps a night's chunk's night, times, campaign and visibility, with no document", () => {
    assert.deepEqual(
      rowFromChunk({
        night: "toe-wittine-session-3",
        start: 1_000,
        end: 9_000,
        campaign: "toe-wittine",
        visibility: "toe-wittine/party",
        text: "Elder Briar lights the ward.",
      }),
      {
        night: "toe-wittine-session-3",
        start_ms: 1_000,
        end_ms: 9_000,
        document: null,
        campaign: "toe-wittine",
        visibility: "toe-wittine/party",
        text: "Elder Briar lights the ward.",
      },
    );
  });

  it("keeps a document's name and visibility, with no night, times or campaign", () => {
    assert.deepEqual(
      rowFromDocument({
        document: "barovia-strahd-plan",
        visibility: "barovia/dm",
        text: "Strahd's plan.",
      }),
      {
        night: null,
        start_ms: null,
        end_ms: null,
        document: "barovia-strahd-plan",
        campaign: null,
        visibility: "barovia/dm",
        text: "Strahd's plan.",
      },
    );
  });
});
