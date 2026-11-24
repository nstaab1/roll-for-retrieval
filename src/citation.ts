// Citations: where a fact in an answer came from. A night's chunk is cited by
// its night and the moment the chunk starts, a document's by its name. The
// eval reads these, never the answer's text, so a lucky phrase can't count.
import type { ChunkRow } from "./store.ts";

export type Citation =
  { night: string; start_ms: number } | { document: string };

// The citation for one chunk.
export function citationOf(chunk: ChunkRow): Citation {
  if (chunk.night !== null) {
    return { night: chunk.night, start_ms: chunk.start_ms ?? 0 };
  }
  if (chunk.document === null) {
    throw new Error(`A chunk with no night and no document: ${chunk.text}`);
  }
  return { document: chunk.document };
}

// Milliseconds into a night as the commands print a moment: "1:02:33".
export function formatMoment(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// A citation as one line: a night and the moment in it, or a document.
export function formatCitation(citation: Citation): string {
  if ("night" in citation) {
    return `${citation.night} at ${formatMoment(citation.start_ms)}`;
  }
  return citation.document;
}

// Where a chunk came from, as the commands and the prompt print it.
export function sourceOf(chunk: ChunkRow): string {
  return formatCitation(citationOf(chunk));
}
