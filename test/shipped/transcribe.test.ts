// `npm run transcribe` ships ready. These tests run whisper-cli for real on
// fifteen seconds of the windmill clip, so they need the workshop image's
// models and the fetched clips.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { readCostLog } from "../../src/cost-log.ts";
import {
  readMeta,
  readSegments,
  transcriptPaths,
} from "../../src/transcript.ts";
import { cutSeconds, fifteenSecondsOfWindmill } from "../windmill.ts";

const script = path.resolve(import.meta.dirname, "../../scripts/transcribe.ts");

function scratch(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "transcribe-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function transcribe(dir: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    env: { ...process.env, COST_LOG: path.join(dir, "cost-log.jsonl") },
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("npm run transcribe", () => {
  it("refuses to run without --campaign, and shows the flag", (t) => {
    const dir = scratch(t);

    const { status, stderr } = transcribe(dir, "windmill.mp3");

    assert.equal(status, 1);
    assert.match(stderr, /--campaign/);
    assert.match(stderr, /npm run transcribe -- --campaign/);
  });

  it("refuses a Whisper model the image doesn't have, naming the two it does", (t) => {
    const dir = scratch(t);

    const { status, stderr } = transcribe(
      dir,
      "--campaign",
      "barovia",
      "--model",
      "large-v3",
      "windmill.mp3",
    );

    assert.equal(status, 1);
    assert.match(stderr, /large-v3.*base\.en and small\.en/);
  });

  it("writes whisper.cpp's segments and a meta file carrying the campaign, and logs the run at $0", (t) => {
    const dir = scratch(t);
    const audio = path.join(dir, "windmill-fifteen-seconds.mp3");
    fifteenSecondsOfWindmill(audio);

    const { status, stdout, stderr } = transcribe(
      dir,
      "--campaign",
      "barovia",
      audio,
    );

    assert.equal(status, 0, stderr);
    const paths = transcriptPaths(audio);
    const segments = readSegments(paths.json);
    assert.ok(segments.length > 0, "no segments");
    for (const segment of segments) {
      assert.equal(typeof segment.text, "string");
      assert.ok(segment.offsets.to > segment.offsets.from, "an empty segment");
      assert.match(segment.timestamps.from, /^\d\d:\d\d:\d\d,\d\d\d$/);
    }
    const meta = readMeta(paths.meta);
    assert.equal(meta.campaign, "barovia");
    assert.equal(meta.source, "windmill-fifteen-seconds.mp3");
    assert.equal(meta.model, "base.en");
    assert.ok(
      Math.abs(meta.audioSeconds - cutSeconds) < 0.5,
      `${meta.audioSeconds}`,
    );
    assert.ok(meta.wallSeconds > 0);
    assert.equal(meta.segments, segments.length);
    assert.ok(
      !Number.isNaN(Date.parse(meta.transcribedAt)),
      meta.transcribedAt,
    );
    const lines = readCostLog(path.join(dir, "cost-log.jsonl"));
    assert.equal(lines.length, 1, "one cost log line per run");
    const [line] = lines;
    assert.equal(line.stage, "local-transcription");
    assert.equal(line.model, "base.en");
    assert.equal(line.dollars, 0);
    assert.ok(Math.abs(line.audioSeconds! - cutSeconds) < 0.5);
    assert.equal(line.seconds, meta.wallSeconds, "one measurement, two places");
    assert.match(stdout, /Wrote .*windmill-fifteen-seconds\.json/);
    assert.match(stdout, /windmill-fifteen-seconds\.meta\.json/);
  });

  it("runs the slower small.en model when asked, and says so in the meta file and the cost log", (t) => {
    const dir = scratch(t);
    const audio = path.join(dir, "windmill-fifteen-seconds.mp3");
    fifteenSecondsOfWindmill(audio);

    const { status, stdout, stderr } = transcribe(
      dir,
      "--campaign",
      "barovia",
      "--model",
      "small.en",
      audio,
    );

    assert.equal(status, 0, stderr);
    assert.equal(readMeta(transcriptPaths(audio).meta).model, "small.en");
    assert.equal(
      readCostLog(path.join(dir, "cost-log.jsonl"))[0].model,
      "small.en",
    );
    assert.match(stdout, /with small\.en\. About \d+ (s|min)/);
  });
});
