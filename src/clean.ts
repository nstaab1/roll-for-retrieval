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
  // #region clean
  // (1) A night is its campaign's party: whatever the DM says at the table,
  // the players heard.
  const visibility = `${night.campaign}/party`;
  const records: SegmentRecord[] = [];
  for (const segment of night.segments) {
    // (2) whisper.cpp starts every segment with a space.
    const text = segment.text.trim();
    // (3) A repetition loop: Whisper writes the same segment again and again.
    // Keep the first.
    if (text === records.at(-1)?.text) continue;
    records.push({
      night: night.id,
      start: segment.offsets.from,
      end: segment.offsets.to,
      campaign: night.campaign,
      visibility,
      text,
    });
  }
  return records;
  // #endregion
}
