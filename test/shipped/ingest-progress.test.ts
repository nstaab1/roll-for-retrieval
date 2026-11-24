// Ingest's progress lines while the embedding runs, so the minute a rebuild
// can take never looks like a hang. Fake timers and a promise stand in for the
// embedding calls, so it needs no key and no network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { printWhileEmbedding, progressEveryMs } from "../../src/ingest.ts";

describe("progress while the embedding runs", () => {
  it("prints the time so far every interval until the embedding finishes", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const printed: string[] = [];
    const { promise, resolve } = Promise.withResolvers<string>();
    const result = printWhileEmbedding(promise, (line) => printed.push(line));

    t.mock.timers.tick(progressEveryMs - 1);
    assert.deepEqual(printed, [], "Nothing prints before the first interval.");
    t.mock.timers.tick(1);
    t.mock.timers.tick(progressEveryMs);
    resolve("embedded");
    assert.equal(
      await result,
      "embedded",
      "It hands back the embedded chunks.",
    );
    t.mock.timers.tick(progressEveryMs);

    const seconds = progressEveryMs / 1000;
    assert.deepEqual(
      printed,
      [
        `Still embedding: ${seconds} s so far.`,
        `Still embedding: ${2 * seconds} s so far.`,
      ],
      "One line per interval while the embedding runs, and none after it ends.",
    );
  });

  it("stops printing when the embedding fails", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const printed: string[] = [];
    const result = printWhileEmbedding(
      Promise.reject(new Error("No hosted key.")),
      (line) => printed.push(line),
    );

    await assert.rejects(result, /No hosted key/);
    t.mock.timers.tick(3 * progressEveryMs);
    assert.deepEqual(
      printed,
      [],
      "The progress lines stop once the embedding fails.",
    );
  });
});
