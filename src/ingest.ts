// Ingest: every night and every document, into one vector store. It runs the
// night loader, your cleaning and chunker from Act 2, and the document loader,
// then embeds and indexes all of it with your code from Act 3.
import { chunkNight } from "./chunk.ts";
import { clean } from "./clean.ts";
import { documentsRoot, loadDocuments } from "./documents.ts";
import { embedChunks } from "./embed.ts";
import { loadNights, transcriptsRoot } from "./nights.ts";
import {
  createStore,
  indexChunks,
  rowFromChunk,
  rowFromDocument,
  type IndexSettings,
  type Store,
} from "./store.ts";
import { formatDuration } from "./transcript.ts";

export interface IngestOptions {
  transcripts?: string;
  documents?: string;
  print?: (line: string) => void;
}

// Builds a store in memory at `settings`. Save it with saveStore.
export async function buildIndex(
  settings: IndexSettings,
  {
    transcripts = transcriptsRoot(),
    documents = documentsRoot(),
    print = console.log,
  }: IngestOptions = {},
): Promise<Store> {
  const nights = loadNights(transcripts, print);
  const fromNights = nights
    .flatMap((night) =>
      chunkNight(clean(night), settings.chunkSize, settings.chunkOverlap),
    )
    .map(rowFromChunk);
  const fromDocuments = loadDocuments(documents).map(rowFromDocument);
  const documentCount = new Set(fromDocuments.map((row) => row.document)).size;
  print(
    `Loaded ${documentCount} document${documentCount === 1 ? "" : "s"} from ${documents}.`,
  );

  const rows = [...fromNights, ...fromDocuments];
  print(
    `Embedding ${rows.length} chunks with ${settings.model}: ${fromNights.length} from the nights, ${fromDocuments.length} from the documents.`,
  );
  const embedded = await printWhileEmbedding(
    embedChunks(rows, settings.model),
    print,
  );
  print(`Indexing ${embedded.length} chunks.`);
  const store = await createStore(settings);
  try {
    await indexChunks(store, embedded);
  } catch (error) {
    await store.db.close();
    throw error;
  }
  return store;
}

// How often ingest says the embedding is still running. A full rebuild can
// spend most of a minute on it, and silence that long looks like a hang: a
// Ctrl-C then leaves the old index in place. Indexing gets one line up front
// instead, since PGlite holds the event loop while it inserts and no timer
// fires until it finishes.
export const progressEveryMs = 10_000;

// Prints `Still embedding: N s so far.` every progressEveryMs until
// `embedding` settles, and hands back its result.
export async function printWhileEmbedding<T>(
  embedding: Promise<T>,
  print: (line: string) => void,
): Promise<T> {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    print(
      `Still embedding: ${formatDuration((ticks * progressEveryMs) / 1000)} so far.`,
    );
  }, progressEveryMs);
  try {
    return await embedding;
  } finally {
    clearInterval(timer);
  }
}
