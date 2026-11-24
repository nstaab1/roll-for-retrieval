// Act 2: the chunker. These tests check the shape of your chunks, never the
// size and overlap you chose. They run your code at your values and at four
// other settings, so code that only works for one choice still fails. They
// need no key and no network, and fail on the starter with the stub's message.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { CHUNK_OVERLAP, CHUNK_SIZE } from "../../src/choices.ts";
import type { SegmentRecord } from "../../src/clean.ts";
import { chunkNight, chunkText, type Chunk } from "../../src/chunk.ts";
import { readMeta, readSegments } from "../../src/transcript.ts";
import { requireChoice } from "../require-choice.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");

describe("your chunk choices", () => {
  it("include a chunk size", () => {
    const size = requireChoice("CHUNK_SIZE", "act-2", 4);
    assert.ok(
      Number.isInteger(size) && size > 0,
      "CHUNK_SIZE counts characters, so it's a whole number above 0.",
    );
  });

  it("include an overlap", () => {
    const overlap = requireChoice("CHUNK_OVERLAP", "act-2", 4);
    assert.ok(
      Number.isInteger(overlap) && overlap >= 0,
      "CHUNK_OVERLAP counts segments, so it's 0 or a whole number above it.",
    );
  });
});

// One prepared night as records, built here rather than by your cleaning, so a
// failure below is the chunker's.
function recordsOf(id: string): SegmentRecord[] {
  const dir = path.join(repoRoot, "transcripts");
  const { campaign } = readMeta(path.join(dir, `${id}.meta.json`));
  return readSegments(path.join(dir, `${id}.json`)).map((segment) => ({
    night: id,
    start: segment.offsets.from,
    end: segment.offsets.to,
    campaign,
    visibility: `${campaign}/party`,
    text: segment.text.trim(),
  }));
}

// A night from each campaign.
const nights = [
  recordsOf("barovia-2025-12-29"),
  recordsOf("toe-wittine-session-3"),
];

// The records each chunk holds, as [first, last] indexes. Each chunk is
// looked for where it can start: after the chunk before it starts, and no
// later than the record after that chunk ends. Fails on a chunk that isn't a
// run of whole segments carrying on from the one before.
function runsOf(
  chunks: Chunk[],
  records: SegmentRecord[],
): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (const [k, chunk] of chunks.entries()) {
    const before = runs.at(-1);
    const earliest = before ? before[0] + 1 : 0;
    const latest = before ? before[1] + 1 : 0;
    let run: [number, number] | undefined;
    for (let first = earliest; first <= latest && !run; first++) {
      const last = lastOfRun(records, first, chunk.text);
      if (last !== undefined) run = [first, last];
    }
    assert.ok(
      run,
      `Chunk ${k + 1} isn't whole segments carrying on from chunk ${k}. It starts:\n  ${chunk.text.slice(0, 120)}`,
    );
    runs.push(run);
  }
  return runs;
}

// The last record of the run from `first` whose text is `text`, if there is one.
function lastOfRun(
  records: SegmentRecord[],
  first: number,
  text: string,
): number | undefined {
  if (first >= records.length) return undefined;
  let joined = records[first].text;
  let last = first;
  while (joined.length < text.length && last + 1 < records.length) {
    last++;
    joined += ` ${records[last].text}`;
  }
  return joined === text ? last : undefined;
}

const settings: Array<{ size: number; overlap: number; label: string }> = [
  { size: 80, overlap: 0, label: "size 80, overlap 0" },
  { size: 300, overlap: 1, label: "size 300, overlap 1" },
  { size: 300, overlap: 3, label: "size 300, overlap 3" },
  { size: 1200, overlap: 2, label: "size 1200, overlap 2" },
];
if (CHUNK_SIZE !== null && CHUNK_OVERLAP !== null) {
  settings.unshift({
    size: CHUNK_SIZE,
    overlap: CHUNK_OVERLAP,
    label: `your size ${CHUNK_SIZE}, overlap ${CHUNK_OVERLAP}`,
  });
}

for (const { size, overlap, label } of settings) {
  describe(`the chunker at ${label}`, () => {
    it("holds whole segments, in order, from the night's first to its last", () => {
      for (const records of nights) {
        const runs = runsOf(chunkNight(records, size, overlap), records);
        assert.equal(
          runs[0]?.[0],
          0,
          "The first chunk should start the night.",
        );
        assert.equal(
          runs.at(-1)?.[1],
          records.length - 1,
          "The night's last segments are in no chunk.",
        );
        for (let k = 1; k < runs.length; k++) {
          assert.ok(
            runs[k][1] > runs[k - 1][1],
            `Chunk ${k + 1} adds no segment that chunk ${k} didn't have.`,
          );
        }
      }
    });

    it("stays within size, unless one segment is longer than size by itself", () => {
      for (const records of nights) {
        const chunks = chunkNight(records, size, overlap);
        for (const [k, [first, last]] of runsOf(chunks, records).entries()) {
          assert.ok(
            chunks[k].text.length <= size || first === last,
            `Chunk ${k + 1} has ${chunks[k].text.length} characters and more than one segment. Size is ${size}.`,
          );
        }
      }
    });

    it("closes a chunk only when the next segment won't fit", () => {
      for (const records of nights) {
        const runs = runsOf(chunkNight(records, size, overlap), records);
        for (const [k, [first, last]] of runs.slice(0, -1).entries()) {
          const withNext = chunkText(records.slice(first, last + 2)).length;
          assert.ok(
            withNext > size,
            `Chunk ${k + 1} closed with room left: the next segment would make ${withNext} characters, within size ${size}.`,
          );
        }
      }
    });

    it(`starts each chunk by repeating ${overlap} segments, unless they leave no room for the next one`, () => {
      for (const records of nights) {
        const runs = runsOf(chunkNight(records, size, overlap), records);
        for (let k = 1; k < runs.length; k++) {
          const [firstBefore, lastBefore] = runs[k - 1];
          const next = lastBefore + 1;
          let expected = Math.max(next - overlap, firstBefore);
          while (
            expected < next &&
            chunkText(records.slice(expected, next + 1)).length > size
          ) {
            expected++;
          }
          assert.equal(
            runs[k][0],
            expected,
            `Chunk ${k + 1} repeats ${next - runs[k][0]} segments from chunk ${k}. Overlap is ${overlap}.`,
          );
        }
      }
    });

    it("carries its night, start, end, campaign and visibility from its segments", () => {
      for (const records of nights) {
        const chunks = chunkNight(records, size, overlap);
        for (const [k, [first, last]] of runsOf(chunks, records).entries()) {
          const { night, start, end, campaign, visibility } = chunks[k];
          assert.deepEqual(
            { night, start, end, campaign, visibility },
            {
              night: records[first].night,
              start: records[first].start,
              end: records[last].end,
              campaign: records[first].campaign,
              visibility: records[first].visibility,
            },
            `Chunk ${k + 1} should carry its first segment's night, start, campaign and visibility, and its last segment's end. Act 4 cites them and the last hour filters on them.`,
          );
        }
      }
    });
  });
}
