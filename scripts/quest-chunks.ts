// `npm run quest:chunks [-- --size N]` cuts one stretch of the windmill
// finale every N characters and prints the chunks, the way the chunk viewer
// page shows them. It reads a prepared transcript and calls no model, so it
// spends nothing.
//
// The cutter ignores where segments end, on purpose: it shows what a cut does
// when nothing guides it, before Act 2's chunker cuts between segments.
import path from "node:path";
import { parseArgs } from "node:util";
import { transcriptsRoot } from "../src/nights.ts";
import { readSegments, textOf, type Segment } from "../src/transcript.ts";

// The stretch: Morgantha forced back from another plane, Freya's parents
// remembering her, Morgantha petrified. One scene, inside the Act 1 clip.
// `from` and `to` are times into the night, and a segment belongs to the
// stretch when it starts between them.
export const stretch = {
  night: "barovia-2025-12-29",
  title: "The windmill finale",
  from: "2:14:03",
  to: "2:16:50",
};

// The sizes the page shows, in characters: one that splits nearly every
// fact, one that splits a few, and one that holds the whole scene.
export const sizes = [200, 800, 3000];

// Cuts `text` every `size` characters, with no overlap. The last chunk holds
// what's left.
export function cutEvery(text: string, size: number): string[] {
  if (!(size >= 1)) {
    throw new Error(`A chunk size is at least 1 character, not ${size}.`);
  }
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += size) {
    chunks.push(text.slice(at, at + size));
  }
  return chunks;
}

// One chunk in three parts: `head` is the second half of a word the cut
// before it split, `tail` the first half of one the cut after it splits, and
// either is empty when its cut lands beside a space.
export interface SplitChunk {
  head: string;
  middle: string;
  tail: string;
}

// Whether the cut between two chunks lands inside a word.
function cutsMidWord(before: string, after: string): boolean {
  return /\S$/.test(before) && /^\S/.test(after);
}

// Each chunk with the halves of the words its cuts split picked out.
export function splitWords(chunks: string[]): SplitChunk[] {
  return chunks.map((text, i) => {
    const before = chunks[i - 1];
    const after = chunks[i + 1];
    const head =
      before !== undefined && cutsMidWord(before, text)
        ? /^\S+/.exec(text)![0]
        : "";
    const rest = text.slice(head.length);
    const tail =
      after !== undefined && cutsMidWord(text, after)
        ? (/\S+$/.exec(rest)?.[0] ?? "")
        : "";
    return { head, middle: rest.slice(0, rest.length - tail.length), tail };
  });
}

// How many of the cuts land inside a word.
export function wordsCutInTwo(chunks: string[]): number {
  return chunks.slice(1).filter((chunk, i) => cutsMidWord(chunks[i], chunk))
    .length;
}

// The stretch's segments as one text, the way the hosted call returns it.
export function readStretch(dir: string = transcriptsRoot()): string {
  const segments = readSegments(path.join(dir, `${stretch.night}.json`));
  return textOf(between(segments, stretch.from, stretch.to));
}

// The segments that start between `from` and `to`.
function between(segments: Segment[], from: string, to: string): Segment[] {
  const [start, end] = [milliseconds(from), milliseconds(to)];
  return segments.filter(
    (s) => s.offsets.from >= start && s.offsets.from < end,
  );
}

// "2:14:03" as milliseconds.
export function milliseconds(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return ((h * 60 + m) * 60 + s) * 1000;
}

// 1387 as "1,387", the way the page and the terminal print sizes.
export const withCommas = (n: number) => n.toLocaleString("en-US");

// The heading over one size's chunks, on the page and in the terminal.
export function cutSummary(size: number, chunks: string[]): string {
  const split = wordsCutInTwo(chunks);
  const count = (n: number, noun: string) =>
    `${n} ${noun}${n === 1 ? "" : "s"}`;
  return `${withCommas(size)} characters: ${count(chunks.length, "chunk")}, ${count(split, "word")} cut in two`;
}

// The terminal's first line, naming the stretch.
function stretchLine(text: string): string {
  return `${stretch.title}: ${stretch.night}, ${stretch.from} to ${stretch.to}, ${withCommas(text.length)} characters.`;
}

// The line that says the cutter ignores segments on purpose.
export const onPurpose =
  "The cutter counts characters and ignores where segments end, on purpose.";

// One size's chunks as a table: the chunk's number, then its text wrapped to
// `width`, with a rule between chunks where the page draws its gold break.
function table(size: number, chunks: string[], width: number): string[] {
  const gutter = String(chunks.length).length + 2;
  const lines = [cutSummary(size, chunks)];
  chunks.forEach((chunk, i) => {
    if (i > 0) lines.push(`${" ".repeat(gutter)}${"─".repeat(width)}`);
    wrap(chunk, width).forEach((line, j) => {
      const number = j === 0 ? String(i + 1) : "";
      lines.push(`${number.padStart(gutter - 2)}  ${line}`.trimEnd());
    });
  });
  return lines;
}

// Breaks text on spaces so no line is wider than `width`, except a single
// word that is. A chunk's edges stay as cut, so a split word shows.
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// The terminal's width, or 100 when it doesn't say.
function terminalColumns(): number {
  return process.stdout.columns || Number(process.env.COLUMNS) || 100;
}

// What a bad --size prints.
const usage =
  "--size takes a whole number of characters. Usage: npm run quest:chunks -- --size 500";

// The size asked for with --size, the page's sizes when none is, or
// undefined when it isn't a whole number above 0.
function sizesAsked(args: string[]): number[] | undefined {
  let size: string | undefined;
  try {
    size = parseArgs({ args, options: { size: { type: "string" } } }).values
      .size;
  } catch {
    return undefined;
  }
  if (size === undefined) return sizes;
  return /^[1-9]\d*$/.test(size) ? [Number(size)] : undefined;
}

if (import.meta.main) {
  const asked = sizesAsked(process.argv.slice(2));
  if (!asked) {
    console.error(usage);
    process.exitCode = 1;
  } else {
    const text = readStretch();
    const width = Math.min(terminalColumns(), 100) - 6;
    const lines = [stretchLine(text), onPurpose];
    for (const size of asked) {
      lines.push("", ...table(size, cutEvery(text, size), width));
    }
    console.log(lines.join("\n"));
  }
}
