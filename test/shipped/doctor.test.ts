import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  checkCores,
  checkNode,
  checkWhisperFeatures,
} from "../../scripts/doctor.ts";
import { readCostLog } from "../../src/cost-log.ts";
import { reranker, whisperModels } from "../../src/local-models.ts";
import {
  hostedKeyEnv,
  lineFor,
  readyMachine,
  runDoctor,
  systemInfo,
  writeTool,
} from "../fake-machine.ts";

describe("npm run doctor", () => {
  it("prints one passing line per check and ends in READY when everything is in place", (t) => {
    const machine = readyMachine(t);
    Object.assign(machine.env, hostedKeyEnv());

    const { status, lines, stderr } = runDoctor(machine);

    assert.equal(status, 0, `${lines.join("\n")}\n${stderr}`);
    assert.equal(lines.at(-1), "READY");
    const checks = lines.slice(0, -1);
    assert.equal(checks.length, 9, checks.join("\n"));
    for (const line of checks) {
      assert.match(line, /^[✓!] /, line);
    }
    assert.match(lineFor(checks, "Node"), /^✓ Node v24\./);
    assert.match(lineFor(checks, "ffmpeg"), /^✓ ffmpeg 7\.1\.1-fake/);
    assert.match(lineFor(checks, "whisper-cli"), /^✓ whisper-cli/);
    assert.match(lineFor(checks, "base.en"), /^✓ /);
    assert.match(lineFor(checks, "small.en"), /^✓ /);
    assert.match(lineFor(checks, "ms-marco-MiniLM-L-6-v2"), /^✓ /);
    assert.match(lineFor(checks, " key"), /^✓ (OpenRouter|OpenAI) key/);
    assert.match(lineFor(checks, "clips"), /^✓ 3 sample clips in audio\//);
    assert.match(lineFor(checks, "CPU cores"), /^[✓!] /);
  });

  it("writes the key check's call as the first line of the cost log", (t) => {
    const machine = readyMachine(t);
    Object.assign(machine.env, hostedKeyEnv());

    runDoctor(machine);

    const [first] = readCostLog(machine.costLog);
    assert.ok(first, "the doctor wrote no cost log line");
    assert.equal(first.stage, "embedding");
    assert.ok(first.dollars > 0);
    assert.equal(first.test, true);
  });

  it("fails with no key, and its fix hint points at .env", (t) => {
    const machine = readyMachine(t);

    const { status, lines } = runDoctor(machine);

    assert.equal(status, 1);
    assert.match(lineFor(lines, "No hosted key"), /^✗ .*Fix: .*\.env/);
    assert.match(lines.at(-1)!, /^NOT READY: 1 check failed\./);
    assert.deepEqual(readCostLog(machine.costLog), []);
  });

  it("fails a key the provider rejects, and its fix hint points at .env", (t) => {
    const machine = readyMachine(t);
    writeFileSync(
      path.join(machine.root, ".env"),
      "OPENAI_API_KEY=sk-not-a-real-key\n",
    );

    const { status, lines } = runDoctor(machine);

    assert.equal(status, 1);
    assert.match(
      lineFor(lines, "rejected"),
      /^✗ OpenAI rejected the key from \.env.*Fix: .*\.env/,
    );
  });

  it("fails a missing Whisper model with a fix hint and ends NOT READY", (t) => {
    const machine = readyMachine(t);
    rmSync(
      path.join(machine.env.WHISPER_MODELS_DIR!, whisperModels["small.en"]),
    );

    const { status, lines } = runDoctor(machine);

    assert.equal(status, 1);
    assert.match(lineFor(lines, "small.en"), /^✗ .*Fix: /);
    assert.match(lineFor(lines, "base.en"), /^✓ /);
    assert.match(lines.at(-1)!, /^NOT READY: 2 checks failed\./);
  });

  it("fails a missing reranker file with a fix hint", (t) => {
    const machine = readyMachine(t);
    rmSync(
      path.join(
        machine.env.TRANSFORMERS_CACHE_DIR!,
        reranker.id,
        "onnx/model_quantized.onnx",
      ),
    );

    const { status, lines } = runDoctor(machine);

    assert.equal(status, 1);
    assert.match(
      lineFor(lines, "ms-marco-MiniLM-L-6-v2"),
      /^✗ .*model_quantized\.onnx.*Fix: /,
    );
  });

  it("fails a clip with a wrong checksum, and its fix hint reruns the fetch", (t) => {
    const machine = readyMachine(t);
    writeFileSync(
      path.join(machine.audio, "barovia-2025-12-29-windmill-finale.mp3"),
      "the windmill finale, re-encoded",
    );

    const { status, lines } = runDoctor(machine);

    assert.equal(status, 1);
    assert.match(
      lineFor(lines, "clips"),
      /^✗ Sample clips: barovia-2025-12-29-windmill-finale\.mp3 has the wrong checksum\. Fix: run npm run fetch-clips\./,
    );
  });

  it("fails missing clips, naming each one", (t) => {
    const machine = readyMachine(t);
    rmSync(path.join(machine.audio, "toe-wittine-session-3-mimic-chest.mp3"));
    rmSync(
      path.join(machine.audio, "barovia-2025-12-23-blinsky-missing-order.mp3"),
    );

    const { status, lines } = runDoctor(machine);

    assert.equal(status, 1);
    assert.match(
      lineFor(lines, "clips"),
      /^✗ Sample clips: barovia-2025-12-23-blinsky-missing-order\.mp3 and toe-wittine-session-3-mimic-chest\.mp3 are missing from audio\/\. Fix: run npm run fetch-clips\./,
    );
  });

  it("fails missing tools with fix hints", (t) => {
    const machine = readyMachine(t);
    rmSync(path.join(machine.bin, "ffmpeg"));
    rmSync(path.join(machine.bin, "whisper-cli"));

    const { status, lines } = runDoctor(machine);

    assert.equal(status, 1);
    assert.match(lineFor(lines, "ffmpeg"), /^✗ ffmpeg not found\. Fix: /);
    assert.match(
      lineFor(lines, "whisper-cli"),
      /^✗ whisper-cli not found\. Fix: /,
    );
    assert.match(lines.at(-1)!, /^NOT READY: 3 checks failed\./);
  });

  it("fails whisper-cli when it prints no system_info line", (t) => {
    const machine = readyMachine(t);
    writeTool(
      machine.bin,
      "whisper-cli",
      "#!/bin/sh\necho 'segfault' >&2\nexit 139\n",
    );

    const { status, lines } = runDoctor(machine);

    assert.equal(status, 1);
    assert.match(lineFor(lines, "whisper-cli"), /^✗ .*system_info.*Fix: /);
  });

  it("skips the whisper-cli run when the base.en model is missing, and says why", (t) => {
    const machine = readyMachine(t);
    rmSync(
      path.join(machine.env.WHISPER_MODELS_DIR!, whisperModels["base.en"]),
    );

    const { lines } = runDoctor(machine);

    assert.match(
      lineFor(lines, "whisper-cli"),
      /^✗ whisper-cli not checked: .*base\.en/,
    );
    assert.match(lines.at(-1)!, /^NOT READY: 3 checks failed\./);
  });
});

describe("whisper-cli's system_info line", () => {
  it("passes on x64 with AVX2 = 1", () => {
    const result = checkWhisperFeatures(systemInfo(1), "x64");
    assert.equal(result.status, "ok");
    assert.match(result.message, /AVX2 = 1/);
  });

  it("fails on x64 with AVX2 = 0, with a fix hint", () => {
    const result = checkWhisperFeatures(systemInfo(0), "x64");
    assert.equal(result.status, "fail");
    assert.match(result.message, /AVX2 = 0/);
    assert.ok(result.fix);
  });

  it("ignores AVX2 on arm64, where the line has no AVX2 field", () => {
    const arm =
      "system_info: n_threads = 4 / 4 | WHISPER : COREML = 0 | CPU : NEON = 1 | ARM_FMA = 1 | FP16_VA = 1 | OPENMP = 1 |";
    assert.equal(checkWhisperFeatures(arm, "arm64").status, "ok");
  });

  it("fails when the output has no system_info line", () => {
    const result = checkWhisperFeatures(
      "error: failed to load model\n",
      "arm64",
    );
    assert.equal(result.status, "fail");
    assert.match(result.message, /error: failed to load model/);
  });
});

describe("Node version", () => {
  it("passes Node 24", () => {
    assert.equal(checkNode("v24.0.0").status, "ok");
  });

  it("fails Node 22 with a fix hint", () => {
    const result = checkNode("v22.12.0");
    assert.equal(result.status, "fail");
    assert.ok(result.fix);
  });
});

describe("CPU cores", () => {
  it("passes at 4 cores", () => {
    assert.equal(checkCores(4).status, "ok");
  });

  it("warns below 4 cores, with a fix hint", () => {
    const result = checkCores(2);
    assert.equal(result.status, "warn");
    assert.ok(result.fix);
  });
});
