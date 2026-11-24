// `npm run doctor`: the one definition of ready. One line per check, each failure
// with a fix hint, then READY or NOT READY.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { APIConnectionError, APIError } from "openai";
import {
  audioDir,
  checkClip,
  manifestFile,
  manifestPath,
  readManifest,
  type ClipState,
} from "../src/clips.ts";
import { providers } from "../src/config.ts";
import { embed, findKey } from "../src/hosted.ts";
import {
  reranker,
  rerankerFilePaths,
  whisperModelPath,
  whisperModels,
  type WhisperModel,
} from "../src/local-models.ts";

export type Status = "ok" | "warn" | "fail";

export interface CheckResult {
  status: Status;
  message: string;
  fix?: string;
}

const MIN_NODE_MAJOR = 24;
const MIN_CORES = 4;

const OPEN_IN_CONTAINER =
  "open the repo in its codespace or dev container, where the workshop image has it.";
const REBUILD =
  "run Rebuild Container from the Command Palette to pull the workshop image again.";
const FETCH = "run npm run fetch-clips.";

const ok = (message: string): CheckResult => ({ status: "ok", message });
const fail = (message: string, fix: string): CheckResult => ({
  status: "fail",
  message,
  fix,
});

export function checkNode(version: string = process.version): CheckResult {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  if (major >= MIN_NODE_MAJOR) return ok(`Node ${version}`);
  return fail(
    `Node ${version} is older than Node ${MIN_NODE_MAJOR}.`,
    OPEN_IN_CONTAINER,
  );
}

export function checkCores(
  cores: number = availableParallelism(),
): CheckResult {
  if (cores >= MIN_CORES) return ok(`${cores} CPU cores`);
  return {
    status: "warn",
    message: `${cores} CPU cores, so local transcription will be slow. ${MIN_CORES} recommended.`,
    fix: `create the codespace on a ${MIN_CORES}-core machine.`,
  };
}

// whisper-cli prints a line such as
// `system_info: n_threads = 4 / 4 | CPU : SSE3 = 1 | AVX2 = 1 | ...` to stderr.
export function checkWhisperFeatures(
  stderr: string,
  arch: string = process.arch,
): CheckResult {
  const line = stderr.split("\n").find((l) => l.startsWith("system_info:"));
  if (!line) {
    const last = stderr.trim().split("\n").at(-1) || "no output";
    return fail(`whisper-cli printed no system_info line (${last}).`, REBUILD);
  }
  if (arch !== "x64") return ok(`whisper-cli (${arch})`);
  const avx2 = /\bAVX2 = (\d+)/.exec(line)?.[1] ?? "missing";
  if (avx2 === "1") return ok("whisper-cli, AVX2 = 1");
  return fail(
    `whisper-cli reports AVX2 = ${avx2}, so transcription will crawl.`,
    REBUILD,
  );
}

function checkFfmpeg(): CheckResult {
  const result = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return fail("ffmpeg not found.", OPEN_IN_CONTAINER);
  }
  const version = /^ffmpeg version (\S+)/.exec(result.stdout)?.[1] ?? "";
  return ok(`ffmpeg ${version}`.trim());
}

function checkWhisperModel(model: WhisperModel): CheckResult {
  const file = whisperModelPath(model);
  if (existsSync(file)) return ok(`Whisper ${model} model`);
  return fail(`Whisper ${model} model missing at ${file}.`, OPEN_IN_CONTAINER);
}

function checkReranker(): CheckResult {
  const missing = rerankerFilePaths().filter((file) => !existsSync(file));
  if (missing.length === 0) return ok(`Reranker model ${reranker.id}`);
  return fail(
    `Reranker model ${reranker.id} is missing ${missing.join(", ")}.`,
    OPEN_IN_CONTAINER,
  );
}

function checkWhisperCli(): CheckResult {
  const model = whisperModelPath("base.en");
  if (!existsSync(model)) {
    return fail(
      "whisper-cli not checked: it needs the base.en model, which is missing.",
      OPEN_IN_CONTAINER,
    );
  }
  // whisper-cli prints system_info only once it has read some audio.
  const dir = mkdtempSync(path.join(tmpdir(), "doctor-"));
  try {
    const audio = path.join(dir, "silence.wav");
    writeFileSync(audio, silentWav(1));
    const result = spawnSync("whisper-cli", ["-m", model, "-f", audio], {
      encoding: "utf8",
    });
    if (
      (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
    ) {
      return fail("whisper-cli not found.", OPEN_IN_CONTAINER);
    }
    return checkWhisperFeatures(result.stderr ?? "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Every clip in the manifest, byte for byte, in audio/.
export function checkClips(): CheckResult {
  if (!existsSync(manifestPath())) {
    return fail(
      `No clip manifest at ${manifestFile}.`,
      "run npm run doctor from the repo root.",
    );
  }
  const { clips } = readManifest();
  const checks: ClipCheck[] = clips.map((clip) => ({
    file: clip.file,
    state: checkClip(clip),
  }));
  const missing = filesIn(checks, "missing");
  const wrong = filesIn(checks, "wrong checksum");
  if (missing.length === 0 && wrong.length === 0) {
    return ok(`${clips.length} sample clips in ${audioDir}/`);
  }
  const problems = [
    missing.length > 0 &&
      `${listOf(missing)} ${missing.length === 1 ? "is" : "are"} missing from ${audioDir}/`,
    wrong.length > 0 &&
      `${listOf(wrong)} ${wrong.length === 1 ? "has" : "have"} the wrong checksum`,
  ].filter(Boolean);
  return fail(`Sample clips: ${problems.join("; ")}.`, FETCH);
}

interface ClipCheck {
  file: string;
  state: ClipState;
}

function filesIn(checks: ClipCheck[], state: ClipState): string[] {
  return checks.filter((c) => c.state === state).map((c) => c.file);
}

function listOf(files: string[]): string {
  if (files.length <= 1) return files.join("");
  return `${files.slice(0, -1).join(", ")} and ${files.at(-1)}`;
}

// One embedding of one word: the cheapest call that proves the key works. It
// is the first line of the cost log.
export async function checkKey(): Promise<CheckResult> {
  const found = findKey();
  if (!found) {
    return fail(
      "No hosted key.",
      `copy .env.example to .env, then put your key after ${providers.openrouter.keyName}= (or after ${providers.openai.keyName}= for an OpenAI key).`,
    );
  }
  const { label, keyName } = providers[found.provider];
  const [where, fixKey] =
    found.from === ".env"
      ? [".env", `check ${keyName} in .env against the key ${label} shows you.`]
      : [
          "the environment",
          `check ${keyName} in your environment or Codespaces secrets, which win over .env.`,
        ];
  try {
    await embed(["ready"]);
    return ok(`${label} key from ${where}`);
  } catch (error) {
    if (error instanceof APIConnectionError) {
      return fail(
        `Couldn't reach ${label}: ${error.message}`,
        `check the network, then run npm run doctor again. The key wasn't tested.`,
      );
    }
    if (
      error instanceof APIError &&
      (error.status === 401 || error.status === 403)
    ) {
      return fail(
        `${label} rejected the key from ${where} (${error.status}).`,
        fixKey,
      );
    }
    const why = error instanceof Error ? error.message : String(error);
    return fail(`${label} refused the key check: ${why}`, fixKey);
  }
}

// 16 kHz mono 16-bit PCM, the format whisper-cli reads without help.
export function silentWav(seconds: number): Buffer {
  const rate = 16000;
  const dataBytes = seconds * rate * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

const marks: Record<Status, string> = { ok: "✓", warn: "!", fail: "✗" };

function formatResult({ status, message, fix }: CheckResult): string {
  return fix
    ? `${marks[status]} ${message} Fix: ${fix}`
    : `${marks[status]} ${message}`;
}

function verdict(failed: number): string {
  if (failed === 0) return "READY";
  const checks = failed === 1 ? "check" : "checks";
  return `NOT READY: ${failed} ${checks} failed. Fix the ✗ lines, then run npm run doctor again.`;
}

if (import.meta.main) {
  const checks: Array<() => CheckResult | Promise<CheckResult>> = [
    () => checkNode(),
    checkFfmpeg,
    ...(Object.keys(whisperModels) as WhisperModel[]).map(
      (model) => () => checkWhisperModel(model),
    ),
    checkReranker,
    checkWhisperCli,
    checkKey,
    checkClips,
    () => checkCores(),
  ];
  const results: CheckResult[] = [];
  for (const check of checks) {
    const result = await check();
    console.log(formatResult(result));
    results.push(result);
  }
  const failed = results.filter((r) => r.status === "fail").length;
  console.log(verdict(failed));
  process.exitCode = failed === 0 ? 0 : 1;
}
