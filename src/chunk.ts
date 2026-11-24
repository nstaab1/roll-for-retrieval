// Act 2: add the chunker. The explainer page has the code: guide/act-2.html
import type { SegmentRecord } from "./clean.ts";

// A run of whole segments from one night, and what Act 4 needs to cite it and
// the last hour needs to filter it.
export interface Chunk {
  night: string;
  // Milliseconds into the recording: the first segment's start and the last
  // segment's end.
  start: number;
  end: number;
  campaign: string;
  visibility: string;
  // The segments' text, joined by spaces. This is what gets embedded.
  text: string;
}

// The chunk sizes the Act 2 page offers, in characters. The local reranker in
// Act 4 reads at most 512 tokens, question and chunk together. Measured with
// its own tokenizer, a chunk of the prepared transcripts at the biggest size
// here still leaves room for the question.
export const chunkSizesToTry = [300, 600, 900, 1200];

// Cuts one night's records into chunks of whole segments. `size` counts
// characters and `overlap` counts segments.
export function chunkNight(
  records: SegmentRecord[],
  size: number,
  overlap: number,
): Chunk[] {
  // #region chunkNight
  const chunks: Chunk[] = [];
  let current: SegmentRecord[] = [];
  for (const record of records) {
    // (4) Close the chunk when the next segment won't fit.
    if (current.length > 0 && chunkText([...current, record]).length > size) {
      chunks.push(toChunk(current));
      // (5) Start the next chunk with the last few segments of this one.
      current = overlap > 0 ? current.slice(-overlap) : [];
      // (6) Let go of repeated segments that leave no room for the new one.
      while (
        current.length > 0 &&
        chunkText([...current, record]).length > size
      ) {
        current.shift();
      }
    }
    current.push(record);
  }
  // (7) The last chunk never hits the size limit, so close it here.
  if (current.length > 0) chunks.push(toChunk(current));
  return chunks;
  // #endregion
}

// Builds one chunk from its records.
function toChunk(records: SegmentRecord[]): Chunk {
  // #region toChunk
  const first = records[0];
  // (8) Where it came from and who may see it, carried from the segments.
  return {
    night: first.night,
    start: first.start,
    end: records[records.length - 1].end,
    campaign: first.campaign,
    visibility: first.visibility,
    text: chunkText(records),
  };
  // #endregion
}

// The records' text as one chunk holds it: joined by spaces.
export function chunkText(records: SegmentRecord[]): string {
  return records.map((record) => record.text).join(" ");
}
