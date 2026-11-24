// `npm run quest:chunks` cuts a stretch of the windmill finale every N
// characters, ignoring where segments end. It reads a prepared transcript and
// calls no model, so these tests need no key and no network.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import {
  cutEvery,
  readStretch,
  sizes,
  splitWords,
  stretch,
  wordsCutInTwo,
} from "../../scripts/quest-chunks.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const script = path.join(repoRoot, "scripts/quest-chunks.ts");

// Runs the command from the repo root, as npm does, with no key set.
function questChunks(...args: string[]) {
  const { OPENAI_API_KEY, OPENROUTER_API_KEY, NODE_TEST_CONTEXT, ...env } =
    process.env;
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...env, COLUMNS: "100" },
  });
}

describe("cutEvery", () => {
  it("cuts every `size` characters with no overlap, leaving the rest to the last chunk", () => {
    assert.deepEqual(cutEvery("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  });

  it("loses nothing: the chunks join back into the text", () => {
    const text = "The windmill burns. Freya runs. Morgantha falls.";
    for (const size of [1, 7, 20, text.length, 1000]) {
      assert.equal(cutEvery(text, size).join(""), text, `size ${size}`);
    }
  });

  it("refuses a size under 1, which would never finish", () => {
    assert.throws(() => cutEvery("abc", 0), /at least 1/);
  });
});

describe("wordsCutInTwo", () => {
  it("counts the cuts that land inside a word", () => {
    assert.equal(wordsCutInTwo(["You smell Elderhe", "art Hollow."]), 1);
  });

  it("doesn't count a cut beside a space", () => {
    assert.equal(wordsCutInTwo(["You smell ", "Elderheart"]), 0);
    assert.equal(wordsCutInTwo(["You smell", " Elderheart"]), 0);
  });
});

describe("splitWords", () => {
  it("picks out the halves of each word a cut lands in", () => {
    assert.deepEqual(splitWords(["You smell Elderhe", "art Hollow."]), [
      { head: "", middle: "You smell ", tail: "Elderhe" },
      { head: "art", middle: " Hollow.", tail: "" },
    ]);
  });

  it("gives a chunk cut inside one word at both ends to its head", () => {
    assert.deepEqual(splitWords(["El", "der", "heart"])[1], {
      head: "der",
      middle: "",
      tail: "",
    });
  });
});

describe("the stretch", () => {
  it("is one scene of the windmill finale, from Morgantha's fall to her petrification", () => {
    const text = readStretch(path.join(repoRoot, "transcripts"));
    assert.equal(stretch.night, "barovia-2025-12-29");
    assert.match(text, /^And she falls\./);
    assert.match(text, /is petrified at this moment\.$/);
  });

  it("splits a word at the smaller sizes and fits whole at the largest", () => {
    const text = readStretch(path.join(repoRoot, "transcripts"));
    const [small, medium, large] = sizes;
    assert.ok(wordsCutInTwo(cutEvery(text, small)) > 0);
    assert.ok(wordsCutInTwo(cutEvery(text, medium)) > 0);
    assert.equal(cutEvery(text, large).length, 1);
  });
});

describe("npm run quest:chunks", () => {
  it("cuts the stretch at 200, 800 and 3,000 characters with no key set", () => {
    const result = questChunks();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /barovia-2025-12-29, 2:14:03 to 2:16:50/);
    assert.match(result.stdout, /ignores where segments end, on purpose/);
    assert.match(result.stdout, /^200 characters: 7 chunks, /m);
    assert.match(result.stdout, /^800 characters: 2 chunks, /m);
    assert.match(result.stdout, /^3,000 characters: 1 chunk, /m);
    assert.match(result.stdout, /Elderhe$/m, "a chunk ends inside the word");
    assert.match(result.stdout, /^ *2 +art Hollow\./m, "the next starts in it");
  });

  it("tries another size with --size", () => {
    const result = questChunks("--size", "500");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^500 characters: 3 chunks, /m);
    assert.doesNotMatch(result.stdout, /^200 characters/m);
  });

  for (const size of ["0", "-5", "12.5", "many"]) {
    it(`refuses --size ${size}`, () => {
      const result = questChunks("--size", size);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /--size takes a whole number of characters/);
    });
  }
});
