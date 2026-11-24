// `npm run catch-up -- <checkpoint>` brings a checkpoint branch's files onto
// the branch you're on, so you can start the next act. You never leave your
// branch, and src/choices.ts and DECISIONS.md stay as you have them.
//
// In order, it
//   1. fetches the checkpoint's branch from the workshop repo: `upstream` once
//      Codespaces has forked it for you, `origin` until then;
//   2. commits your work in progress, if there is any, so it stays in history;
//   3. copies the checkpoint's files over yours, except those two files;
//   4. commits "Caught up to act 3." or the checkpoint's name.
// It copies files and never deletes one, so anything you added stays. A value
// you never set in src/choices.ts stays null, and the tests ask you to pick it.
import { spawnSync } from "node:child_process";
import { testFolders } from "./test.ts";

// The files that are yours, whichever checkpoint you catch up to.
const attendeeFiles = ["src/choices.ts", "DECISIONS.md"];

const accepted = "1 to 4, fix-hallucination or fix-access-leak";

// A checkpoint's branch, and how its commit names it. Every test folder but
// `shipped` is a checkpoint with a branch of the same name.
function checkpointFor(
  name: string,
): { branch: string; label: string } | undefined {
  const act = /^(?:act-)?([1-4])$/.exec(name)?.[1];
  if (act) return { branch: `act-${act}`, label: `act ${act}` };
  const branch = testFolders.slice(1).find((folder) => folder === name);
  return branch && { branch, label: branch };
}

// Why catch-up stopped, worded for the attendee.
class CatchUpError extends Error {
  name = "CatchUpError";
}

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    ok: result.status === 0,
    out: result.stdout.trim(),
    err: (result.stderr || result.stdout).trim(),
  };
}

function mustGit(cwd: string, args: string[]): string {
  const result = git(cwd, args);
  if (!result.ok) {
    throw new CatchUpError(`git ${args.join(" ")} failed:\n${result.err}`);
  }
  return result.out;
}

// The remote that holds the workshop's checkpoint branches.
function workshopRemote(repo: string): string {
  const remotes = mustGit(repo, ["remote"]).split("\n");
  if (remotes.includes("upstream")) return "upstream";
  if (remotes.includes("origin")) return "origin";
  throw new CatchUpError(
    "This repo has no origin or upstream remote to fetch the checkpoint from.",
  );
}

// Catches the repo at `cwd` up to the checkpoint `name`. Returns what it did,
// one line each.
export function catchUp(cwd: string, name: string): string[] {
  const checkpoint = checkpointFor(name);
  if (!checkpoint) {
    throw new CatchUpError(
      `No checkpoint called "${name}". Use ${accepted}, such as npm run catch-up -- 3.`,
    );
  }
  const { branch, label } = checkpoint;
  const repo = mustGit(cwd, ["rev-parse", "--show-toplevel"]);
  const remote = workshopRemote(repo);

  // Fetch first, so a failed fetch leaves everything as it was.
  const fetched = git(repo, [
    "fetch",
    "--quiet",
    remote,
    `refs/heads/${branch}`,
  ]);
  if (!fetched.ok) {
    throw new CatchUpError(
      `Couldn't fetch ${branch} from ${remote}:\n${fetched.err}\nCheck the network, then run npm run catch-up -- ${name} again.`,
    );
  }
  const source = mustGit(repo, ["rev-parse", "FETCH_HEAD"]);

  const lines: string[] = [];
  mustGit(repo, ["add", "-A"]);
  if (!git(repo, ["diff", "--cached", "--quiet"]).ok) {
    mustGit(repo, [
      "commit",
      "--quiet",
      "-m",
      `Work in progress before catching up to ${label}.`,
    ]);
    const saved = mustGit(repo, ["rev-parse", "--short", "HEAD"]);
    lines.push(`Saved your work in progress as commit ${saved}.`);
  }

  mustGit(repo, [
    "checkout",
    source,
    "--",
    ".",
    ...attendeeFiles.map((file) => `:(exclude)${file}`),
  ]);
  if (git(repo, ["diff", "--cached", "--quiet"]).ok) {
    lines.push(`Already caught up to ${label}. Nothing to change.`);
    return lines;
  }
  mustGit(repo, ["commit", "--quiet", "-m", `Caught up to ${label}.`]);
  lines.push(
    `Caught up to ${label}. Your ${attendeeFiles.join(" and ")} are as you left them.`,
  );
  return lines;
}

if (import.meta.main) {
  const name = process.argv[2] ?? "";
  try {
    for (const line of catchUp(process.cwd(), name)) console.log(line);
  } catch (error) {
    if (!(error instanceof CatchUpError)) throw error;
    console.error(
      name
        ? error.message
        : `Name a checkpoint: npm run catch-up -- <checkpoint>. Use ${accepted}.`,
    );
    process.exitCode = 1;
  }
}
