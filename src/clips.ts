// The sample clips: what the manifest says about each, where the fetch script
// puts them, and whether a copy on disk matches. Audio never enters git; the
// manifest is the committed record of the release.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface Clip {
  file: string;
  title: string;
  campaign: string;
  night: string;
  bytes: number;
  sha256: string;
}

export interface Manifest {
  // The GitHub release tag the clips are uploaded to.
  release: string;
  clips: Clip[];
}

// Both live in the folder the command runs from, which npm makes the repo root.
export const manifestFile = "clips.json";
export const audioDir = "audio";

export function manifestPath(): string {
  return path.resolve(manifestFile);
}

export function audioRoot(): string {
  return path.resolve(audioDir);
}

export function audioPath(file: string): string {
  return path.join(audioRoot(), file);
}

// A clip's size the way the fetch and cut commands print it.
export function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function readManifest(file: string = manifestPath()): Manifest {
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

// The public workshop repo, whose release holds the clips.
export const workshopRepo = "nstaab1/roll-for-retrieval";

// The release's direct download URL, which GitHub serves without counting it
// against the API's rate limit. CLIPS_URL points a test at a local server.
export function clipUrl(release: string, file: string): string {
  const base =
    process.env.CLIPS_URL ??
    `https://github.com/${workshopRepo}/releases/download/${release}`;
  return `${base}/${file}`;
}

export type ClipState = "ok" | "missing" | "wrong checksum";

// Whether the copy at `file` is the clip the manifest describes. A size
// mismatch is a wrong checksum too; the bytes are a cheap first look.
export function checkClip(
  clip: Clip,
  file: string = audioPath(clip.file),
): ClipState {
  if (!existsSync(file)) return "missing";
  if (statSync(file).size !== clip.bytes) return "wrong checksum";
  return sha256(file) === clip.sha256 ? "ok" : "wrong checksum";
}

export function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
