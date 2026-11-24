// Act 3: embed the chunks. The explainer page has the code: guide/act-3.html
import { embed } from "./hosted.ts";
import type { ChunkRow, EmbeddedChunk } from "./store.ts";

// The most chunks one embedding request carries. Both providers take a few
// thousand texts or about 300,000 tokens a request. 256 chunks at the biggest
// chunk size is well under both.
export const embedBatchSize = 256;

// Embeds every chunk with `model`, in batches, through the shipped client.
// Returns each chunk with its vector, in the order given.
export async function embedChunks(
  chunks: ChunkRow[],
  model: string,
): Promise<EmbeddedChunk[]> {
  throw new Error("Not added yet. Open guide/act-3.html, step 1.");
}
