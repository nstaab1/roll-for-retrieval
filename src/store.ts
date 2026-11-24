// The vector store: PGlite, which is Postgres compiled to run inside Node, with
// the pgvector extension. Every chunk from the nights and the documents is one
// row, its vector beside it. A built index is saved to one file, which also
// records the chunk size, overlap and embedding model it was built at.
//
// Act 3: add indexChunks. The explainer page has the code: guide/act-3.html
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Chunk } from "./chunk.ts";
import type { DocumentChunk } from "./documents.ts";

// One chunk as the store holds it, from a night or a document. A night's chunk
// has its night and times, and no document. A document's has its name and no
// night, times or campaign: its visibility says whose it is.
export interface ChunkRow {
  night: string | null;
  // Milliseconds into the recording.
  start_ms: number | null;
  end_ms: number | null;
  document: string | null;
  campaign: string | null;
  visibility: string;
  text: string;
}

export interface EmbeddedChunk extends ChunkRow {
  embedding: number[];
}

// A row the search returned, and how far its vector is from the question's.
export interface Hit extends ChunkRow {
  distance: number;
}

// What an index was built at. A question is embedded with the same model, and
// the Act 3 page prints all three.
export interface IndexSettings {
  chunkSize: number;
  chunkOverlap: number;
  model: string;
}

export interface Store {
  db: PGlite;
  settings: IndexSettings;
}

// The table every chunk goes in. There is no approximate-search index on
// `embedding`: a few thousand rows is a fast exact scan, and an exact scan
// returns the true top k even when the last hour adds a filter.
const schema = `
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE chunks (
    id serial PRIMARY KEY,
    night text,
    start_ms integer,
    end_ms integer,
    document text,
    campaign text,
    -- Who may see it. The last hour filters on this column.
    visibility text NOT NULL,
    text text NOT NULL,
    -- No fixed length, so the large embedding model's vectors fit too.
    embedding vector NOT NULL
  );
  CREATE TABLE settings (
    chunk_size integer NOT NULL,
    chunk_overlap integer NOT NULL,
    model text NOT NULL
  );
`;

// An empty store in memory, which remembers what it will be built at.
export async function createStore(settings: IndexSettings): Promise<Store> {
  const db = await PGlite.create({ extensions: { vector } });
  await db.exec(schema);
  await db.query(
    "INSERT INTO settings (chunk_size, chunk_overlap, model) VALUES ($1, $2, $3)",
    [settings.chunkSize, settings.chunkOverlap, settings.model],
  );
  return { db, settings };
}

// Writes the whole store, rows and settings, to one gzipped file.
export async function saveStore(store: Store, file: string): Promise<void> {
  const dump = await store.db.dumpDataDir("gzip");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await dump.arrayBuffer()));
}

// Opens a saved store in memory. Close it with `store.db.close()` when done,
// or the command never exits.
export async function openStore(file: string): Promise<Store> {
  const db = await PGlite.create({
    extensions: { vector },
    loadDataDir: new Blob([readFileSync(file)]),
  });
  const { rows } = await db.query<{
    chunk_size: number;
    chunk_overlap: number;
    model: string;
  }>("SELECT chunk_size, chunk_overlap, model FROM settings");
  const [row] = rows;
  if (!row) {
    await db.close();
    throw new Error(
      `${file} doesn't say what it was built at. Rebuild it with npm run ingest.`,
    );
  }
  const settings = {
    chunkSize: row.chunk_size,
    chunkOverlap: row.chunk_overlap,
    model: row.model,
  };
  return { db, settings };
}

export async function countChunks(store: Store): Promise<number> {
  const { rows } = await store.db.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM chunks",
  );
  return rows[0].count;
}

// A vector as pgvector reads it from a query parameter: `[0.1,0.2,…]`.
export function toVector(numbers: number[]): string {
  return JSON.stringify(numbers);
}

// The act 3 checkpoint carries the shipped index, built at the presenter's
// values. `npm run ingest` writes yours beside it, at your values, and git
// leaves yours out.
export const indexPaths = {
  shipped: "index/shipped.tar.gz",
  yours: "index/yours.tar.gz",
} as const;

// The index to search: yours once you've built it, the shipped one before.
// Paths are in the folder the command runs from, which npm makes the repo
// root.
export function findIndex(root: string = process.cwd()): string {
  for (const file of [indexPaths.yours, indexPaths.shipped]) {
    const full = path.resolve(root, file);
    if (existsSync(full)) return full;
  }
  throw new Error(
    "No index to search yet. Run npm run ingest to build one at your values, or npm run catch-up -- 3 to get the shipped one.",
  );
}

// A night's chunk as a row.
export function rowFromChunk(chunk: Chunk): ChunkRow {
  return {
    night: chunk.night,
    start_ms: chunk.start,
    end_ms: chunk.end,
    document: null,
    campaign: chunk.campaign,
    visibility: chunk.visibility,
    text: chunk.text,
  };
}

// A document's chunk as a row.
export function rowFromDocument(chunk: DocumentChunk): ChunkRow {
  return {
    night: null,
    start_ms: null,
    end_ms: null,
    document: chunk.document,
    campaign: null,
    visibility: chunk.visibility,
    text: chunk.text,
  };
}

// Inserts every embedded chunk as one row of `chunks`.
export async function indexChunks(
  store: Store,
  chunks: EmbeddedChunk[],
): Promise<void> {
  // #region indexChunks
  // (4) One transaction: every row lands, or none does.
  await store.db.transaction(async (tx) => {
    for (const chunk of chunks) {
      // (5) Each field the chunk carries gets its own column.
      await tx.query(
        `INSERT INTO chunks
           (night, start_ms, end_ms, document, campaign, visibility, text, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          chunk.night,
          chunk.start_ms,
          chunk.end_ms,
          chunk.document,
          chunk.campaign,
          chunk.visibility,
          chunk.text,
          toVector(chunk.embedding),
        ],
      );
    }
  });
  // #endregion
}
