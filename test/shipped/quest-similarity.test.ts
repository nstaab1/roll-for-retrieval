// `npm run quest:similarity` compares eight phrases by meaning. These tests
// run it with no key and no network: the math, the table, and the published
// grid it prints in a key's place.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  cosine,
  formatGrid,
  gridOf,
  phrases,
  scoreOf,
} from "../../scripts/quest-similarity.ts";

const script = path.resolve(
  import.meta.dirname,
  "../../scripts/quest-similarity.ts",
);

// A checkout with a published grid in guide/, or without one.
const checkouts: string[] = [];
function checkout(published: boolean) {
  const dir = mkdtempSync(path.join(tmpdir(), "quest-similarity-"));
  checkouts.push(dir);
  if (published) {
    mkdirSync(path.join(dir, "guide"));
    const grid = {
      model: "published-model",
      phrases,
      scores: phrases.map((_, i) => phrases.map((_, j) => (i === j ? 1 : 0.5))),
    };
    writeFileSync(
      path.join(dir, "guide/similarity.json"),
      JSON.stringify(grid),
    );
  }
  return dir;
}
after(() =>
  checkouts.forEach((d) => rmSync(d, { recursive: true, force: true })),
);

// Runs the command from `cwd` with no key set, from a folder with no .env.
function run(cwd: string, ...args: string[]) {
  const { OPENAI_API_KEY, OPENROUTER_API_KEY, NODE_TEST_CONTEXT, ...env } =
    process.env;
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
}

describe("cosine", () => {
  it("is 1 for vectors that point the same way, whatever their length", () => {
    assert.equal(cosine([1, 2, 3], [2, 4, 6]).toFixed(6), "1.000000");
  });

  it("is 0 for vectors at right angles and -1 for opposite ones", () => {
    assert.equal(cosine([1, 0], [0, 1]), 0);
    assert.equal(cosine([1, 0], [-1, 0]), -1);
  });

  it("refuses vectors of different lengths", () => {
    assert.throws(() => cosine([1, 2], [1, 2, 3]), /can't be compared/);
  });
});

describe("the phrases", () => {
  it("are the eight the page compares", () => {
    assert.equal(phrases.length, 8);
    assert.deepEqual(phrases.slice(0, 7), [
      "Blinsky",
      "the toymaker",
      "Blinsky's Toys",
      "a toy shop in town",
      "the blacksmith",
      "the windmill",
      "Morgantha",
    ]);
  });
});

describe("gridOf and formatGrid", () => {
  const grid = gridOf(
    ["a", "b"],
    [
      [1, 0],
      [1, 1],
    ],
    "m",
  );

  it("scores every pair, mirrored on the diagonal", () => {
    assert.equal(scoreOf(grid, "a", "a"), 1);
    assert.equal(scoreOf(grid, "a", "b"), scoreOf(grid, "b", "a"));
    assert.equal(scoreOf(grid, "a", "b").toFixed(2), "0.71");
  });

  it("prints a numbered row per phrase with scores to two places", () => {
    const lines = formatGrid(grid).split("\n");
    assert.equal(lines.length, 3);
    assert.match(lines[1], /^1  a +1\.00 0\.71$/);
    assert.match(lines[2], /^2  b +0\.71 1\.00$/);
  });
});

describe("npm run quest:similarity with no key", () => {
  it("prints the published grid and says so", () => {
    const result = run(checkout(true));
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /^No hosted key, so this is the published grid/,
    );
    assert.match(result.stdout, /published-model/);
    assert.match(result.stdout, /^8 +Pizza, pizza, pizza\. +0\.50/m);
  });

  it("says there is no grid to print when the checkout has none", () => {
    const result = run(checkout(false));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no published grid/);
  });

  it("says phrases of your own need a key", () => {
    const result = run(checkout(true), "toys", "a shop");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Your own phrases need a key/);
  });

  it("refuses one phrase, which has nothing to compare with", () => {
    const result = run(checkout(true), "toys");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /two or more phrases/);
  });
});
