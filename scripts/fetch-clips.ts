// `npm run fetch-clips`: downloads the sample clips the manifest lists into
// audio/, from the release's direct download URL. Runs at container create;
// the doctor's fix hint runs it again. A clip already in place is left alone,
// and a download that fails its checksum never reaches audio/.
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import {
  audioDir,
  audioPath,
  audioRoot,
  checkClip,
  clipUrl,
  megabytes,
  readManifest,
  type Clip,
} from "../src/clips.ts";

// One clip's line of output, and whether it is in place.
interface Outcome {
  ok: boolean;
  line: string;
}

async function download(url: string, to: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  // The body is a web stream; Node's own type for it is what fromWeb takes.
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream),
    createWriteStream(to),
  );
}

// Puts one clip in audio/, or says why it couldn't. The download lands in a
// .part file and is renamed only once its checksum matches, so audio/ never
// holds a clip the doctor would fail.
export async function fetchClip(clip: Clip, release: string): Promise<Outcome> {
  const target = audioPath(clip.file);
  if (checkClip(clip, target) === "ok") {
    return { ok: true, line: `✓ ${clip.file} already in ${audioDir}/` };
  }
  const url = clipUrl(release, clip.file);
  const part = `${target}.part`;
  try {
    await download(url, part);
    if (checkClip(clip, part) !== "ok") {
      return failed(
        `${clip.file} downloaded with the wrong checksum from ${url}`,
      );
    }
    await rename(part, target);
    return { ok: true, line: `✓ ${clip.file} (${megabytes(clip.bytes)})` };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return failed(`${clip.file}: ${why}`);
  } finally {
    await rm(part, { force: true });
  }
}

function failed(line: string): Outcome {
  return { ok: false, line: `✗ ${line}` };
}

if (import.meta.main) {
  const { release, clips } = readManifest();
  await mkdir(audioRoot(), { recursive: true });
  const outcomes: Outcome[] = [];
  for (const clip of clips) {
    const outcome = await fetchClip(clip, release);
    console.log(outcome.line);
    outcomes.push(outcome);
  }
  const failed = outcomes.filter((o) => !o.ok).length;
  if (failed === 0) {
    console.log(`${clips.length} sample clips in ${audioDir}/.`);
  } else {
    console.log(
      `${failed} of ${clips.length} sample clips not fetched. Check the network, then run npm run fetch-clips again.`,
    );
  }
  process.exitCode = failed === 0 ? 0 : 1;
}
