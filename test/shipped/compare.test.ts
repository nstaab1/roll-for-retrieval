// `npm run compare` reads the two transcripts a clip has beside it and prints
// them side by side. These tests write both files by hand, so they need no
// model and no key.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import {
  transcriptPaths,
  type HostedTranscript,
  type Meta,
  type Segment,
  type WhisperOutput,
} from "../../src/transcript.ts";

const script = path.resolve(import.meta.dirname, "../../scripts/compare.ts");

const segments: Segment[] = [
  {
    timestamps: { from: "00:00:00,000", to: "00:00:02,500" },
    offsets: { from: 0, to: 2500 },
    text: " The windmill is on fire.",
  },
  {
    timestamps: { from: "00:00:02,500", to: "00:00:05,000" },
    offsets: { from: 2500, to: 5000 },
    text: " Freya runs.",
  },
];

const meta: Meta = {
  campaign: "barovia",
  source: "windmill.mp3",
  model: "base.en",
  audioSeconds: 600,
  wallSeconds: 123,
  segments: 2,
  transcribedAt: "2026-01-12T14:30:00.000Z",
};

const hosted: HostedTranscript = {
  source: "windmill.mp3",
  model: "openai/gpt-transcribe",
  audioSeconds: 600,
  wallSeconds: 12.4,
  dollars: 0.045,
  text: "The windmill's on fire! Freya runs.",
};

// A folder holding windmill.mp3 and the transcripts named, the hosted one
// with `hostedText` as its text.
function clipWith(
  t: TestContext,
  files: Array<"local" | "hosted">,
  hostedText = hosted.text,
): string {
  const dir = mkdtempSync(path.join(tmpdir(), "compare-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const audio = path.join(dir, "windmill.mp3");
  writeFileSync(audio, "not really audio");
  const paths = transcriptPaths(audio);
  if (files.includes("local")) {
    const output: WhisperOutput = { transcription: segments };
    writeFileSync(paths.json, JSON.stringify(output));
    writeFileSync(paths.meta, JSON.stringify(meta));
  }
  if (files.includes("hosted")) {
    writeFileSync(
      paths.hosted,
      JSON.stringify({ ...hosted, text: hostedText }),
    );
  }
  return audio;
}

function compare(audio: string, columns = 100) {
  const result = spawnSync(process.execPath, [script, audio], {
    cwd: path.dirname(audio),
    env: { ...process.env, COLUMNS: String(columns) },
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("npm run compare", () => {
  it("prints both transcripts' wall time, dollars and text side by side", (t) => {
    const audio = clipWith(t, ["local", "hosted"]);

    const { status, stdout, stderr } = compare(audio);

    assert.equal(status, 0, stderr);
    const lines = stdout.split("\n");
    const header = lines.find((l) => l.includes("base.en"));
    assert.ok(header, stdout);
    assert.match(header, /local.*base\.en.*hosted.*gpt-transcribe/);
    const time = lines.find((l) => l.startsWith("wall time"));
    assert.ok(time, stdout);
    assert.match(time, /2 min 3 s.*12 s/);
    const dollars = lines.find((l) => l.startsWith("dollars"));
    assert.ok(dollars, stdout);
    assert.match(dollars, /\$0\.00.*\$0\.045/);
    const text = lines.find((l) => l.startsWith("text"));
    assert.ok(text, stdout);
    const localAt = text.indexOf("The windmill is on fire. Freya runs.");
    const hostedAt = text.indexOf("The windmill's on fire! Freya runs.");
    assert.ok(localAt > 0 && hostedAt > localAt, text);
  });

  it("prices the local run's wall seconds at the codespace's hourly rate beside its $0", (t) => {
    const audio = clipWith(t, ["local", "hosted"]);

    const { stdout } = compare(audio);

    // 123 s at $0.36 an hour.
    assert.match(stdout, /dollars.*\$0\.000 \(codespace time \$0\.012\)/);
  });

  it("wraps long text inside the terminal's width, keeping the columns apart", (t) => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const audio = clipWith(t, ["local", "hosted"], words);

    const { status, stdout } = compare(audio, 80);

    assert.equal(status, 0);
    const lines = stdout.split("\n");
    for (const line of lines) {
      assert.ok(line.length <= 80, `${line.length} wide: ${line}`);
    }
    const textLines = lines.filter((l) => l.includes("word"));
    assert.ok(textLines.length > 5, stdout);
    const first = textLines.find((l) => l.includes("word0 "));
    assert.ok(first && first.indexOf("word0 ") > 40, first);
  });

  it("names the missing transcript and the command that makes it", (t) => {
    const audio = clipWith(t, ["local"]);

    const { status, stderr } = compare(audio);

    assert.equal(status, 1);
    assert.match(stderr, /windmill\.hosted\.json/);
    assert.match(stderr, /npm run transcribe:hosted -- .*windmill\.mp3/);
  });

  it("points at npm run transcribe when the local transcript is missing", (t) => {
    const audio = clipWith(t, ["hosted"]);

    const { status, stderr } = compare(audio);

    assert.equal(status, 1);
    assert.match(stderr, /windmill\.json/);
    assert.match(
      stderr,
      /npm run transcribe -- --campaign <name> .*windmill\.mp3/,
    );
  });
});
