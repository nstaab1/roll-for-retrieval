// The night loader: reads a folder of transcripts, each night whisper.cpp's
// JSON beside its meta file, and refuses any night it can't place in a
// campaign. The campaign comes from the meta file and nothing else, never from
// a folder or a file name, so an unlabelled night never reaches the vector
// store. A night's id is its file name without `.json`, and it is what
// citations print.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  readMeta,
  readSegments,
  transcriptPaths,
  type Meta,
  type Segment,
} from "./transcript.ts";

export interface Night {
  id: string;
  campaign: string;
  meta: Meta;
  segments: Segment[];
}

// The prepared transcripts' folder, in the folder the command runs from, which
// npm makes the repo root.
export const transcriptsDir = "transcripts";

export function transcriptsRoot(): string {
  return path.resolve(transcriptsDir);
}

// Loads every night in `dir` and prints them grouped by campaign. Throws on the
// first night with no meta file, no campaign or no `transcription` list, so a
// folder loads whole or not at all.
export function loadNights(
  dir: string,
  print: (line: string) => void = console.log,
): Night[] {
  if (!existsSync(dir)) {
    throw new Error(
      `No transcripts folder at ${dir}. The prepared transcripts are in ${transcriptsDir}/.`,
    );
  }
  const nights = readdirSync(dir)
    .filter(isNightFile)
    .sort(byId)
    .map((file) => loadNight(path.join(dir, file)));
  for (const line of formatNights(dir, nights)) print(line);
  return nights;
}

// whisper.cpp's JSON, leaving out the meta files and the hosted call's text.
function isNightFile(file: string): boolean {
  return (
    file.endsWith(".json") &&
    !file.endsWith(".meta.json") &&
    !file.endsWith(".hosted.json")
  );
}

// Natural order, so toe-wittine-session-10 follows toe-wittine-session-3.
function byId(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

// One night: its id from the file name, its campaign from the meta file only.
function loadNight(file: string): Night {
  const paths = transcriptPaths(file);
  const id = path.basename(paths.base);
  if (!existsSync(paths.meta)) {
    throw new Error(
      `${file} has no meta file, so the loader can't tell which campaign it belongs to. Add ${paths.meta} with a "campaign", or transcribe the audio again with npm run transcribe -- --campaign <name>.`,
    );
  }
  const meta = readMeta(paths.meta);
  const campaign: unknown = meta.campaign;
  if (typeof campaign !== "string" || campaign.trim() === "") {
    throw new Error(
      `${paths.meta} has no "campaign", so the loader can't tell which campaign ${id} belongs to. Add "campaign": "<name>" to it.`,
    );
  }
  const segments = readSegments(file);
  if (!Array.isArray(segments)) {
    throw new Error(
      `${file} has no "transcription" list, so it isn't whisper.cpp's JSON. Write it with npm run transcribe.`,
    );
  }
  return { id, campaign, meta, segments };
}

// The lines loadNights prints: a count, then each campaign with its nights.
export function formatNights(
  dir: string,
  nights: Pick<Night, "id" | "campaign">[],
): string[] {
  if (nights.length === 0) return [`No nights in ${dir}.`];
  const byCampaign = Map.groupBy(nights, (night) => night.campaign);
  const lines = [`Loaded ${count(nights.length)} from ${dir}:`];
  for (const campaign of [...byCampaign.keys()].sort()) {
    const ids = byCampaign
      .get(campaign)!
      .map((night) => night.id)
      .sort(byId);
    lines.push(`${campaign} (${count(ids.length)})`);
    lines.push(...ids.map((id) => `  ${id}`));
  }
  return lines;
}

// "1 night" or "4 nights".
function count(n: number): string {
  return `${n} night${n === 1 ? "" : "s"}`;
}
