// `npm run transcribe -- --campaign <name> [--model <whisper model>] <audio>`
// runs whisper-cli on one audio file and writes its JSON segments and a meta
// file beside it. Local, so the cost log gets wall seconds at $0.
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { elapsedSince, writeCostLine } from "../src/cost-log.ts";
import { audioDuration } from "../src/hosted.ts";
import {
  whisperModelPath,
  whisperModels,
  whisperSecondsPerAudioMinute,
  type WhisperModel,
} from "../src/local-models.ts";
import {
  formatDuration,
  readSegments,
  transcriptPaths,
  type Meta,
} from "../src/transcript.ts";

interface TranscribeOptions {
  audio: string;
  campaign: string;
  model: WhisperModel;
}

const modelNames = Object.keys(whisperModels) as WhisperModel[];

const usage = `npm run transcribe -- --campaign <name> [--model ${modelNames.join("|")}] <audio file>`;

// Reads the command line. Throws a message the command prints as-is.
function parseOptions(args: string[]): TranscribeOptions {
  const { values, positionals } = parseArgs({
    args,
    options: {
      campaign: { type: "string" },
      model: { type: "string", default: "base.en" },
    },
    allowPositionals: true,
  });
  const [audio, ...extra] = positionals;
  if (!audio || extra.length > 0) {
    throw new Error(`Name one audio file to transcribe. Usage: ${usage}`);
  }
  if (!values.campaign) {
    throw new Error(
      `--campaign is required, so the night's meta file can say which campaign it belongs to. Usage: ${usage}`,
    );
  }
  const model = values.model as string;
  if (!isWhisperModel(model)) {
    throw new Error(
      `No Whisper model "${model}". The image has ${modelNames.join(" and ")}.`,
    );
  }
  return { audio, campaign: values.campaign, model };
}

function isWhisperModel(name: string): name is WhisperModel {
  return (modelNames as string[]).includes(name);
}

// Transcribes one file with whisper-cli, which writes the JSON itself, then
// writes the meta file and the cost log line, both carrying the run's wall
// seconds. Prints what it's doing, because the run takes minutes.
function transcribeLocally({
  audio,
  campaign,
  model,
}: TranscribeOptions): Meta {
  if (!existsSync(audio)) {
    throw new Error(
      `No audio file at ${audio}. The sample clips are in audio/; run npm run fetch-clips if that folder is empty.`,
    );
  }
  const audioSeconds = audioDuration(audio);
  const paths = transcriptPaths(audio);
  const estimate = (audioSeconds / 60) * whisperSecondsPerAudioMinute[model];
  console.log(
    `Transcribing ${audio} (${formatDuration(audioSeconds)} of audio) with ${model}. About ${formatDuration(estimate)} on a 4-core codespace. Open a second terminal to keep working.`,
  );

  const started = performance.now();
  runWhisperCli(model, audio, paths.base);
  const wallSeconds = elapsedSince(started);
  // A local stage costs no dollars. The cost summary prices its seconds.
  writeCostLine({
    stage: "local-transcription",
    model,
    audioSeconds,
    dollars: 0,
    seconds: wallSeconds,
  });

  const meta: Meta = {
    campaign,
    source: path.basename(audio),
    model,
    audioSeconds,
    wallSeconds,
    segments: readSegments(paths.json).length,
    transcribedAt: new Date().toISOString(),
  };
  writeFileSync(paths.meta, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(
    `Wrote ${paths.json} (${meta.segments} segments) and ${paths.meta} in ${formatDuration(wallSeconds)}.`,
  );
  return meta;
}

// whisper-cli prints each segment as it goes, which is the progress bar.
function runWhisperCli(model: WhisperModel, audio: string, base: string): void {
  const result = spawnSync(
    "whisper-cli",
    [
      "-m",
      whisperModelPath(model),
      "-f",
      audio,
      "-t",
      String(availableParallelism()),
      "-oj",
      "-of",
      base,
      "-np",
    ],
    { stdio: ["ignore", "inherit", "pipe"], encoding: "utf8" },
  );
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    throw new Error(
      "whisper-cli not found. Open the repo in its codespace or dev container, where the workshop image has it.",
    );
  }
  if (result.status !== 0) {
    const why = result.stderr.trim().split("\n").at(-1) ?? "no output";
    throw new Error(
      `whisper-cli failed on ${audio}: ${why}. Run npm run doctor to check the model files.`,
    );
  }
}

if (import.meta.main) {
  try {
    transcribeLocally(parseOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
