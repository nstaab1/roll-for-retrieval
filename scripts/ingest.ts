// `npm run ingest` builds your index: every night and every document, chunked
// at your CHUNK_SIZE and CHUNK_OVERLAP, embedded with the workshop's embedding
// model, and saved to index/yours.tar.gz with the values it was built at.
// `npm run search` uses yours from then on. It costs a few tenths of a cent
// and takes about a minute.
import path from "node:path";
import * as choices from "../src/choices.ts";
import { models } from "../src/config.ts";
import { costLogPath, elapsedSince, readCostLog } from "../src/cost-log.ts";
import { buildIndex } from "../src/ingest.ts";
import {
  countChunks,
  indexPaths,
  saveStore,
  type IndexSettings,
} from "../src/store.ts";
import { formatDollars, formatDuration } from "../src/transcript.ts";

type ChunkChoices = Pick<typeof choices, "CHUNK_SIZE" | "CHUNK_OVERLAP">;

// Your chunk values and the workshop's embedding model. Throws, naming the
// choice, until both chunk values are set.
export function settingsFrom({
  CHUNK_SIZE,
  CHUNK_OVERLAP,
}: ChunkChoices): IndexSettings {
  for (const [name, value] of [
    ["CHUNK_SIZE", CHUNK_SIZE],
    ["CHUNK_OVERLAP", CHUNK_OVERLAP],
  ] as const) {
    if (value === null) {
      throw new Error(
        `Pick ${name} in src/choices.ts. Open guide/act-2.html, step 4.`,
      );
    }
  }
  return {
    chunkSize: CHUNK_SIZE!,
    chunkOverlap: CHUNK_OVERLAP!,
    model: models.embedding,
  };
}

// What the embedding calls since `since` cost, from the cost log.
function embeddingDollarsSince(since: string): number {
  return readCostLog(costLogPath())
    .filter((line) => line.stage === "embedding" && line.at >= since)
    .reduce((sum, line) => sum + line.dollars, 0);
}

if (import.meta.main) {
  try {
    const settings = settingsFrom(choices);
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const store = await buildIndex(settings);
    try {
      const file = path.resolve(indexPaths.yours);
      await saveStore(store, file);
      const count = await countChunks(store);
      console.log(
        `Saved ${count} chunks to ${indexPaths.yours}, at chunk size ${settings.chunkSize}, overlap ${settings.chunkOverlap}, with ${settings.model}. ${formatDuration(elapsedSince(started))}, ${formatDollars(embeddingDollarsSince(startedAt))}.`,
      );
    } finally {
      await store.db.close();
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
