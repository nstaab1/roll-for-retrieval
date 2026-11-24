// `npm run compare -- <audio>` prints a clip's local and hosted transcripts
// side by side: wall time, dollars and text. Both files sit beside the clip.
import { existsSync } from "node:fs";
import path from "node:path";
import { codespaceDollarsPerHour } from "../src/config.ts";
import {
  formatDollars,
  formatDuration,
  readHosted,
  readMeta,
  readSegments,
  textOf,
  transcriptPaths,
  type HostedTranscript,
  type Meta,
} from "../src/transcript.ts";

// One side of the comparison.
interface Side {
  heading: string;
  wallTime: string;
  dollars: string;
  text: string;
}

const labelWidth = 11;
const gap = 2;

// The local run's side. It cost no dollars, so its wall seconds are priced at
// the codespace's hourly rate beside the $0, the way the cost summary will.
function localSide(meta: Meta, text: string): Side {
  const codespace = (meta.wallSeconds / 3600) * codespaceDollarsPerHour;
  return {
    heading: `local (${meta.model})`,
    wallTime: formatDuration(meta.wallSeconds),
    dollars: `${formatDollars(0)} (codespace time ${formatDollars(codespace)})`,
    text,
  };
}

// The hosted call's side, as the Act 1 code wrote it.
function hostedSide(hosted: HostedTranscript): Side {
  return {
    heading: `hosted (${hosted.model})`,
    wallTime: formatDuration(hosted.wallSeconds),
    dollars: formatDollars(hosted.dollars),
    text: hosted.text,
  };
}

// Two columns of equal width inside `columns`, each row's cells wrapped and
// padded so the right column lines up.
function sideBySide(left: Side, right: Side, columns: number): string {
  const width = Math.max(20, Math.floor((columns - labelWidth - gap) / 2));
  const rows: Array<[string, string, string]> = [
    ["", left.heading, right.heading],
    ["wall time", left.wallTime, right.wallTime],
    ["dollars", left.dollars, right.dollars],
    ["text", left.text, right.text],
  ];
  const lines: string[] = [];
  for (const [label, a, b] of rows) {
    const as = wrap(a, width);
    const bs = wrap(b, width);
    for (let i = 0; i < Math.max(as.length, bs.length); i++) {
      const first = (i === 0 ? label : "").padEnd(labelWidth);
      const cell = (as[i] ?? "").padEnd(width + gap);
      lines.push(`${first}${cell}${bs[i] ?? ""}`.trimEnd());
    }
  }
  return lines.join("\n");
}

// Breaks text on spaces so no line is wider than `width`, except a single
// word that is.
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
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

function terminalColumns(): number {
  return process.stdout.columns || Number(process.env.COLUMNS) || 100;
}

// The clip's two transcripts, or the messages saying which are missing.
function problems(audio: string): string[] {
  const paths = transcriptPaths(audio);
  const name = path.basename(audio);
  const missing: string[] = [];
  if (!existsSync(paths.json) || !existsSync(paths.meta)) {
    missing.push(
      `No local transcript for ${name} at ${paths.json}. Run npm run transcribe -- --campaign <name> ${audio} first.`,
    );
  }
  if (!existsSync(paths.hosted)) {
    missing.push(
      `No hosted transcript for ${name} at ${paths.hosted}. Run npm run transcribe:hosted -- ${audio} first.`,
    );
  }
  return missing;
}

if (import.meta.main) {
  const audio = process.argv[2];
  if (!audio) {
    console.error(
      "Name the clip to compare. Usage: npm run compare -- <audio file>",
    );
    process.exitCode = 1;
  } else if (problems(audio).length > 0) {
    console.error(problems(audio).join("\n"));
    process.exitCode = 1;
  } else {
    const paths = transcriptPaths(audio);
    const local = localSide(
      readMeta(paths.meta),
      textOf(readSegments(paths.json)),
    );
    const hosted = hostedSide(readHosted(paths.hosted));
    console.log(sideBySide(local, hosted, terminalColumns()));
  }
}
