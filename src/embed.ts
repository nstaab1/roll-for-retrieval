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
  // #region embedChunks
  const embedded: EmbeddedChunk[] = [];
  // (1) One request per batch of chunks, not one per chunk.
  for (let i = 0; i < chunks.length; i += embedBatchSize) {
    const batch = chunks.slice(i, i + embedBatchSize);
    // (2) The shipped client: one vector per text, in the order sent.
    const vectors = await embed(
      batch.map((chunk) => chunk.text),
      { model },
    );
    // (3) Each vector rides with its chunk.
    for (const [j, chunk] of batch.entries()) {
      embedded.push({ ...chunk, embedding: vectors[j] });
    }
  }
  return embedded;
  // #endregion
}
