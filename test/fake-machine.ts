// A temporary machine for the doctor and fetch tests: fake tools on PATH, every
// model file in place, a clip manifest with the clips in audio/, and no hosted
// key unless the test adds one. Removed when the test ends.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { manifestFile, type Manifest } from "../src/clips.ts";
import { providers } from "../src/config.ts";
import { findKey, noKeyMessage } from "../src/hosted.ts";
import { reranker, whisperModels } from "../src/local-models.ts";

const doctorScript = path.resolve(import.meta.dirname, "../scripts/doctor.ts");

export const systemInfo = (avx2: number) =>
  `system_info: n_threads = 4 / 4 | WHISPER : COREML = 0 | OPENVINO = 0 | CPU : SSE3 = 1 | SSSE3 = 1 | AVX = 1 | AVX2 = ${avx2} | F16C = 1 | FMA = 1 | OPENMP = 1 |`;

// Only shell builtins, because the tests run the doctor with PATH holding
// nothing but these fakes.
const fakeFfmpeg = `#!/bin/sh
echo "ffmpeg version 7.1.1-fake Copyright (c) 2000-2025 the FFmpeg developers"
`;

const fakeWhisperCli = `#!/bin/sh
while [ $# -gt 0 ]; do
  case "$1" in
    -m) model="$2"; shift ;;
    -f) audio="$2"; shift ;;
  esac
  shift
done
if [ ! -s "$model" ] || [ ! -s "$audio" ]; then
  echo "error: failed to read model or audio" >&2
  exit 1
fi
echo "${systemInfo(1)}" >&2
echo "[BLANK_AUDIO]"
`;

// Three small clips stand in for the five real ones.
export const fakeClips: Record<string, string> = {
  "barovia-2025-12-29-windmill-finale.mp3": "the windmill finale",
  "barovia-2025-12-23-blinsky-missing-order.mp3": "the missing order",
  "toe-wittine-session-3-mimic-chest.mp3": "the mimic chest",
};

export interface Machine {
  root: string;
  bin: string;
  audio: string;
  costLog: string;
  env: NodeJS.ProcessEnv;
}

// The hosted key this test run has, from the environment or the repo's .env,
// as the one variable the doctor reads. With no key, the test fails pointing
// at .env and the doctor script.
export function hostedKeyEnv(): NodeJS.ProcessEnv {
  const found = findKey();
  assert.ok(found, noKeyMessage);
  return { [providers[found.provider].keyName]: found.key };
}

export function readyMachine(t: TestContext): Machine {
  const root = mkdtempSync(path.join(tmpdir(), "doctor-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const models = path.join(root, "whisper");
  const cache = path.join(root, "transformers");
  const audio = path.join(root, "audio");
  mkdirSync(bin);
  mkdirSync(models);
  mkdirSync(audio);
  writeTool(bin, "ffmpeg", fakeFfmpeg);
  writeTool(bin, "whisper-cli", fakeWhisperCli);
  for (const file of Object.values(whisperModels)) {
    writeFileSync(path.join(models, file), "model");
  }
  for (const file of reranker.files) {
    const target = path.join(cache, reranker.id, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "{}");
  }
  for (const [file, contents] of Object.entries(fakeClips)) {
    writeFileSync(path.join(audio, file), contents);
  }
  writeFileSync(
    path.join(root, manifestFile),
    JSON.stringify(manifestOf(fakeClips), null, 2),
  );
  const costLog = path.join(root, "cost-log.jsonl");
  return {
    root,
    bin,
    audio,
    costLog,
    env: {
      PATH: bin,
      HOME: root,
      WHISPER_MODELS_DIR: models,
      TRANSFORMERS_CACHE_DIR: cache,
      COST_LOG: costLog,
      COST_LOG_TEST: "1",
    },
  };
}

// The manifest the fake clips would have if the cut command had made them.
export function manifestOf(clips: Record<string, string>): Manifest {
  return {
    release: "clips-v1",
    clips: Object.entries(clips).map(([file, contents]) => ({
      file,
      title: file.replace(/\.mp3$/, ""),
      campaign: file.startsWith("barovia") ? "barovia" : "toe-wittine",
      night: "night",
      bytes: Buffer.byteLength(contents),
      sha256: createHash("sha256").update(contents).digest("hex"),
    })),
  };
}

export function writeTool(bin: string, name: string, script: string): void {
  const file = path.join(bin, name);
  writeFileSync(file, script);
  chmodSync(file, 0o755);
}

export function runDoctor(machine: Machine) {
  const result = spawnSync(process.execPath, [doctorScript], {
    cwd: machine.root,
    env: machine.env,
    encoding: "utf8",
  });
  const lines = result.stdout.trimEnd().split("\n");
  return { status: result.status, lines, stderr: result.stderr };
}

export function lineFor(lines: string[], text: string): string {
  const line = lines.find((l) => l.includes(text));
  assert.ok(line, `no line mentions ${text}:\n${lines.join("\n")}`);
  return line;
}
