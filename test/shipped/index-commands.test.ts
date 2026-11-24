// `npm run ingest` and `npm run search`: the choices they need and how search
// prints what it found. These tests need no key and no network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { settingsFrom } from "../../scripts/ingest.ts";
import { describeIndex, formatHit, kFrom } from "../../scripts/search.ts";
import { formatMoment } from "../../src/citation.ts";
import { models } from "../../src/config.ts";
import type { Hit } from "../../src/store.ts";

describe("npm run ingest", () => {
  it("builds at your chunk values with the workshop's embedding model", () => {
    assert.deepEqual(settingsFrom({ CHUNK_SIZE: 900, CHUNK_OVERLAP: 0 }), {
      chunkSize: 900,
      chunkOverlap: 0,
      model: models.embedding,
    });
  });

  it("asks for each chunk value you haven't picked, and where to pick it", () => {
    assert.throws(
      () => settingsFrom({ CHUNK_SIZE: null, CHUNK_OVERLAP: 1 }),
      /^Error: Pick CHUNK_SIZE in src\/choices\.ts\. Open guide\/act-2\.html, step 4\./,
    );
    assert.throws(
      () => settingsFrom({ CHUNK_SIZE: 600, CHUNK_OVERLAP: null }),
      /^Error: Pick CHUNK_OVERLAP in src\/choices\.ts/,
    );
  });
});

describe("npm run search", () => {
  it("asks for RETRIEVAL_K until you pick it", () => {
    assert.throws(
      () => kFrom({ RETRIEVAL_K: null }),
      /^Error: Pick RETRIEVAL_K in src\/choices\.ts\. Open guide\/act-3\.html, step 4\.$/,
    );
    assert.equal(kFrom({ RETRIEVAL_K: 12 }), 12);
  });

  it("says which index it searches and what that index was built at", () => {
    assert.equal(
      describeIndex("index/shipped.tar.gz", 1021, {
        chunkSize: 600,
        chunkOverlap: 1,
        model: "openai/text-embedding-3-small",
      }),
      "Searching index/shipped.tar.gz: 1021 chunks at chunk size 600, overlap 1, embedded with openai/text-embedding-3-small.",
    );
  });

  it("prints a moment in a night as hours, minutes and seconds", () => {
    assert.equal(formatMoment(731_320), "0:12:11");
    assert.equal(formatMoment(5_397_000), "1:29:57");
  });

  const hit: Hit = {
    night: "barovia-2026-01-07",
    start_ms: 731_320,
    end_ms: 760_000,
    document: null,
    campaign: "barovia",
    visibility: "barovia/party",
    text: "You start the fire.\nThe windmill starts to take off in flames.",
    distance: 0.41237,
  };

  it("prints a night's hit with its rank, distance, night, moment and visibility", () => {
    assert.deepEqual(formatHit(hit, 3), [
      " 3  0.412  barovia-2026-01-07 at 0:12:11  barovia/party",
      "    You start the fire. The windmill starts to take off in flames.",
    ]);
  });

  it("prints a document's hit by its name and cuts long text short", () => {
    const [head, text] = formatHit(
      {
        ...hit,
        night: null,
        start_ms: null,
        end_ms: null,
        document: "barovia-strahd-plan",
        campaign: null,
        visibility: "barovia/dm",
        text: "x".repeat(400),
      },
      12,
    );
    assert.equal(head, "12  0.412  barovia-strahd-plan  barovia/dm");
    assert.equal(text, `    ${"x".repeat(160)}…`);
  });
});
