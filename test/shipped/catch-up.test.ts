// `npm run catch-up -- <checkpoint>` brings a checkpoint branch's files onto
// the attendee's own branch and keeps their choices and decisions. These tests
// build a small workshop repo in a temp folder, clone it as an attendee would,
// and run the command there, so they need no key and no network.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";

const script = path.resolve(import.meta.dirname, "../../scripts/catch-up.ts");

type Files = Record<string, string>;

const unsetChoices =
  "export const CHUNK_SIZE: number | null = null;\nexport const RETRIEVAL_K: number | null = null;\n";
const emptyDecisions = "# Decisions\n\n## Chunking\n\n## Retrieval\n";

// The real choice guard, so a test on a checkpoint branch asks for a value
// the way the workshop's tests do.
const guard = readFileSync(
  path.resolve(import.meta.dirname, "../require-choice.ts"),
  "utf8",
);

const starter: Files = {
  "package.json": '{ "name": "fixture", "type": "module" }\n',
  "test/require-choice.ts": guard,
  "src/choices.ts": unsetChoices,
  "DECISIONS.md": emptyDecisions,
  "src/chunk.ts":
    'export const chunk = () => {\n  throw new Error("stub");\n};\n',
  "src/search.ts":
    'export const search = () => {\n  throw new Error("stub");\n};\n',
};

// Each checkpoint branch fills stubs. Act 3 also ships the index.
const branches: Record<string, Files> = {
  "act-2": { "src/chunk.ts": "export const chunk = () => 2;\n" },
  "act-3": {
    "src/chunk.ts": "export const chunk = () => 2;\n",
    "src/search.ts": "export const search = () => 3;\n",
    "index/shipped.tar.gz": "the index",
    "test/act-3/search.test.ts": [
      'import { test } from "node:test";',
      'import { requireChoice } from "../require-choice.ts";',
      'test("search", () => {',
      '  requireChoice("CHUNK_SIZE", "act-2", 3);',
      '  requireChoice("RETRIEVAL_K", "act-3", 2);',
      "});",
      "",
    ].join("\n"),
  },
  "fix-hallucination": {
    "src/chunk.ts": "export const chunk = () => 2;\n",
    "src/search.ts": "export const search = () => 3;\n",
    "src/gate.ts": "export const gate = () => true;\n",
  },
};

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "catch-up-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir: string, files: Files): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
}

function identify(repo: string): void {
  git(repo, "config", "user.name", "Attendee");
  git(repo, "config", "user.email", "attendee@example.com");
}

// A bare workshop repo: `main` holds the starter, and each checkpoint branch
// is its own root commit, as publish leaves them, with the starter's files
// plus that checkpoint's. `only` limits the checkpoint branches made.
function workshop(t: TestContext, only = Object.keys(branches)): string {
  const root = tempDir(t);
  const build = path.join(root, "build");
  const bare = path.join(root, "workshop.git");
  git(root, "init", "-q", "--bare", bare);
  git(root, "init", "-q", "-b", "main", build);
  identify(build);
  write(build, starter);
  git(build, "add", "-A");
  git(build, "commit", "-q", "-m", "starter");
  for (const name of only) {
    git(build, "checkout", "-q", "--orphan", name, "main");
    write(build, branches[name]);
    git(build, "add", "-A");
    git(build, "commit", "-q", "-m", name);
  }
  git(build, "push", "-q", bare, "--all");
  return bare;
}

// An attendee's codespace: a clone of `from`, on a branch of their own.
function attendee(t: TestContext, from: string): string {
  const repo = path.join(tempDir(t), "roll-for-retrieval");
  git(path.dirname(repo), "clone", "-q", "--branch", "main", from, repo);
  identify(repo);
  git(repo, "switch", "-q", "-c", "mine");
  return repo;
}

// Runs the command as `npm run catch-up -- <args>` would.
function catchUp(repo: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repo,
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

const read = (repo: string, file: string) =>
  readFileSync(path.join(repo, file), "utf8");
const subjects = (repo: string) => git(repo, "log", "--format=%s").split("\n");
const status = (repo: string) => git(repo, "status", "--porcelain");

// Choices with one value set and one left unset, and a decision written.
const myChoices =
  "export const CHUNK_SIZE: number | null = 800;\nexport const RETRIEVAL_K: number | null = null;\n";
const myDecisions =
  "# Decisions\n\n## Chunking\n\n800 characters kept each night's scenes whole.\n\n## Retrieval\n";

describe("npm run catch-up -- <checkpoint>", () => {
  it("brings act 3's files onto the attendee's branch and keeps their choices and decisions", (t) => {
    const repo = attendee(t, workshop(t));
    write(repo, {
      "src/choices.ts": myChoices,
      "DECISIONS.md": myDecisions,
      "src/chunk.ts": "export const chunk = () => 'half done';\n",
      "notes.txt": "my notes\n",
    });

    const { status: code, output } = catchUp(repo, "3");

    assert.equal(code, 0, output);
    assert.equal(git(repo, "branch", "--show-current"), "mine");
    assert.equal(
      read(repo, "src/search.ts"),
      branches["act-3"]["src/search.ts"],
    );
    assert.equal(read(repo, "src/chunk.ts"), branches["act-3"]["src/chunk.ts"]);
    assert.equal(read(repo, "index/shipped.tar.gz"), "the index");
    assert.equal(read(repo, "src/choices.ts"), myChoices);
    assert.equal(read(repo, "DECISIONS.md"), myDecisions);
    assert.equal(read(repo, "notes.txt"), "my notes\n");
    assert.equal(status(repo), "");
    assert.match(output, /Caught up to act 3\./);
  });

  it("leaves an unset choice for the tests to ask for", (t) => {
    const repo = attendee(t, workshop(t));
    write(repo, { "src/choices.ts": myChoices });

    catchUp(repo, "3");

    // NODE_TEST_CONTEXT would make the inner run report to this one.
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const run = spawnSync(
      process.execPath,
      ["--test", "test/act-3/search.test.ts"],
      { cwd: repo, env, encoding: "utf8" },
    );
    assert.equal(run.status, 1);
    assert.match(
      run.stdout,
      /Pick RETRIEVAL_K in src\/choices\.ts\. Open guide\/act-3\.html, step 2\./,
    );
    assert.doesNotMatch(run.stdout, /Pick CHUNK_SIZE/);
  });

  it("commits the work in progress first, then the catch-up", (t) => {
    const repo = attendee(t, workshop(t));
    write(repo, {
      "src/chunk.ts": "export const chunk = () => 'half done';\n",
    });

    catchUp(repo, "3");

    const [last, before] = subjects(repo);
    assert.equal(last, "Caught up to act 3.");
    assert.equal(before, "Work in progress before catching up to act 3.");
    assert.equal(
      git(repo, "show", "HEAD~1:src/chunk.ts"),
      "export const chunk = () => 'half done';",
    );
  });

  it("makes no work-in-progress commit when there's nothing to save", (t) => {
    const repo = attendee(t, workshop(t));

    catchUp(repo, "2");

    assert.deepEqual(subjects(repo), ["Caught up to act 2.", "starter"]);
  });

  it("names a last-hour checkpoint in its commit", (t) => {
    const repo = attendee(t, workshop(t));

    const { status: code } = catchUp(repo, "fix-hallucination");

    assert.equal(code, 0);
    assert.equal(
      read(repo, "src/gate.ts"),
      "export const gate = () => true;\n",
    );
    assert.equal(subjects(repo)[0], "Caught up to fix-hallucination.");
  });

  it("keeps the attendee's choices when they were committed earlier", (t) => {
    const repo = attendee(t, workshop(t));
    write(repo, { "src/choices.ts": myChoices, "DECISIONS.md": myDecisions });
    git(repo, "commit", "-qam", "Picked a chunk size");

    catchUp(repo, "3");

    assert.equal(read(repo, "src/choices.ts"), myChoices);
    assert.equal(read(repo, "DECISIONS.md"), myDecisions);
    assert.equal(git(repo, "show", "HEAD:src/choices.ts"), myChoices.trim());
  });

  it("fetches from the workshop repo once Codespaces has made a fork", (t) => {
    const upstream = workshop(t);
    // The fork was made before the act branches were published.
    const fork = workshop(t, []);
    const repo = attendee(t, fork);
    git(repo, "remote", "add", "upstream", upstream);

    const { status: code, output } = catchUp(repo, "3");

    assert.equal(code, 0, output);
    assert.equal(
      read(repo, "src/search.ts"),
      branches["act-3"]["src/search.ts"],
    );
  });

  it("says so and commits nothing when already caught up", (t) => {
    const repo = attendee(t, workshop(t));
    catchUp(repo, "3");

    const { status: code, output } = catchUp(repo, "3");

    assert.equal(code, 0);
    assert.match(output, /already/i);
    assert.deepEqual(subjects(repo), ["Caught up to act 3.", "starter"]);
  });

  for (const name of ["5", "act-9", ""]) {
    it(`refuses ${name ? `"${name}"` : "no checkpoint"} and lists the ones it takes`, (t) => {
      const repo = attendee(t, workshop(t));
      write(repo, { "src/chunk.ts": "half done\n" });

      const { status: code, output } = catchUp(repo, ...(name ? [name] : []));

      assert.equal(code, 1);
      assert.match(output, /1 to 4.*fix-hallucination.*fix-access-leak/);
      assert.deepEqual(subjects(repo), ["starter"]);
      assert.equal(read(repo, "src/chunk.ts"), "half done\n");
    });
  }

  it("changes nothing when the checkpoint can't be fetched", (t) => {
    const repo = attendee(t, workshop(t, ["act-2"]));
    write(repo, { "src/chunk.ts": "half done\n" });

    const { status: code, output } = catchUp(repo, "4");

    assert.equal(code, 1);
    assert.match(output, /act-4/);
    assert.match(output, /npm run catch-up -- 4/);
    assert.deepEqual(subjects(repo), ["starter"]);
    assert.equal(read(repo, "src/chunk.ts"), "half done\n");
    assert.equal(status(repo), "M src/chunk.ts");
  });
});
