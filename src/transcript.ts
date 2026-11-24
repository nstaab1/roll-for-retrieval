// A night's transcript on disk: whisper.cpp's JSON beside a meta file that
// says which campaign it belongs to. Local transcription writes both, and the
// prepared transcripts ship in the same shape. The hosted call writes a third
// file with text only, which the vector store never loads.
import { readFileSync } from "node:fs";
import path from "node:path";

// One of whisper.cpp's segments, as `whisper-cli -oj` writes it.
export interface Segment {
  timestamps: { from: string; to: string };
  offsets: { from: number; to: number };
  text: string;
}

// The part of whisper.cpp's JSON the workshop reads.
export interface WhisperOutput {
  transcription: Segment[];
}

// The per-night meta file. `campaign` is the one field the loader insists on;
// the rest records how the transcript was made.
export interface Meta {
  campaign: string;
  source: string;
  model: string;
  audioSeconds: number;
  wallSeconds: number;
  segments: number;
  transcribedAt: string;
}

// What hosted transcription returns: text with no timestamps.
export interface HostedTranscript {
  source: string;
  model: string;
  audioSeconds: number;
  wallSeconds: number;
  dollars: number;
  text: string;
}

export interface TranscriptPaths {
  // whisper.cpp's JSON, and its path without the extension for `-of`.
  json: string;
  base: string;
  meta: string;
  hosted: string;
}

// Where an audio file's transcripts go: beside it, named after it. Nothing
// ever lands in the prepared transcripts' folder by accident.
export function transcriptPaths(audio: string): TranscriptPaths {
  const base = path.join(
    path.dirname(audio),
    path.basename(audio, path.extname(audio)),
  );
  return {
    base,
    json: `${base}.json`,
    meta: `${base}.meta.json`,
    hosted: `${base}.hosted.json`,
  };
}

// The segments in one of whisper.cpp's JSON files.
export function readSegments(file: string): Segment[] {
  const output = JSON.parse(readFileSync(file, "utf8")) as WhisperOutput;
  return output.transcription;
}

// One night's meta file.
export function readMeta(file: string): Meta {
  return JSON.parse(readFileSync(file, "utf8")) as Meta;
}

// The file the hosted call wrote.
export function readHosted(file: string): HostedTranscript {
  return JSON.parse(readFileSync(file, "utf8")) as HostedTranscript;
}

// A transcript's segments as one text, the way the hosted call returns it.
export function textOf(segments: Segment[]): string {
  return segments.map((s) => s.text.trim()).join(" ");
}

// Seconds the way the commands print them: "12 s", "2 min 3 s" or "10 min".
export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole} s`;
  const rest = whole % 60;
  return `${Math.floor(whole / 60)} min${rest > 0 ? ` ${rest} s` : ""}`;
}

// Dollars the way the commands print them, to the tenth of a cent, since a
// ten-minute clip costs a few cents.
export function formatDollars(dollars: number): string {
  return `$${dollars.toFixed(3)}`;
}

// Dollars too small for a tenth of a cent, such as what one question costs:
// to the thousandth of a cent.
export function formatSmallDollars(dollars: number): string {
  return `$${dollars.toFixed(5)}`;
}
