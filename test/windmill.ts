// Fifteen seconds of the windmill clip for the transcription tests: real
// speech, cut once per process with ffmpeg, long enough for the hosted model
// to hear something and short enough to cost a fraction of a cent.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { audioPath } from "../src/clips.ts";

const clip = "barovia-2025-12-29-windmill-finale.mp3";

export const cutSeconds = 15;

let cut: string | undefined;

// Writes the cut to `target`. Fails pointing at the fetch script when the
// clip isn't there.
export function fifteenSecondsOfWindmill(target: string): void {
  if (!cut) {
    const source = audioPath(clip);
    assert.ok(
      existsSync(source),
      `${source} is missing. Run npm run fetch-clips, then run the tests again.`,
    );
    const dir = mkdtempSync(path.join(tmpdir(), "windmill-cut-"));
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
    cut = path.join(dir, "windmill-fifteen-seconds.mp3");
    const result = spawnSync(
      "ffmpeg",
      [
        "-loglevel",
        "error",
        "-ss",
        "60",
        "-t",
        String(cutSeconds),
        "-i",
        source,
        "-c",
        "copy",
        cut,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  copyFileSync(cut, target);
}
