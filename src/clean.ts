// Act 2: clean a night's segments into records. The explainer page has the
// code: guide/act-2.html
import type { Night } from "./nights.ts";

// One segment, cleaned: what was said, when, and who may see it. The chunker
// builds chunks from these, and every field reaches the vector store.
export interface SegmentRecord {
  // The night's id, which citations print.
  night: string;
  // Milliseconds into the recording, from whisper.cpp's offsets.
  start: number;
  end: number;
  campaign: string;
  // Who may see it. A night is always its campaign's `party`.
  visibility: string;
  text: string;
}

// Turns one night's segments into records, in order, with Whisper's
// repetition loops collapsed.
export function clean(night: Night): SegmentRecord[] {
  throw new Error("Not added yet. Open guide/act-2.html, step 1.");
}
