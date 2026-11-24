// `npm run ask`: the choices it needs, how it looks up the asker, and how it
// prints an answer. These tests need no key and no network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeAsker,
  describeSettings,
  formatAsked,
  settingsFrom,
} from "../../scripts/ask.ts";
import { lookUpAsker, type Asked } from "../../src/ask.ts";
import { formatCitation, type Citation } from "../../src/citation.ts";

const allSet = {
  RETRIEVAL_K: 20,
  RERANK_DEPTH: 10,
  CHUNKS_KEPT: 4,
  REFUSAL_INSTRUCTION: "Say you don't know.",
  RELEVANCE_THRESHOLD: null,
};

describe("npm run ask", () => {
  it("runs at your k, rerank depth, chunks kept and refusal instruction", () => {
    assert.deepEqual(settingsFrom(allSet), {
      k: 20,
      depth: 10,
      kept: 4,
      refusal: "Say you don't know.",
    });
  });

  it("adds your relevance threshold once you pick it, and runs without a gate before", () => {
    assert.equal(settingsFrom(allSet).threshold, undefined);
    assert.equal(
      settingsFrom({ ...allSet, RELEVANCE_THRESHOLD: 0.001 }).threshold,
      0.001,
    );
  });

  it("says what search, the reranker and the prompt take, and the gate once there is one", () => {
    const settings = settingsFrom(allSet);
    assert.equal(
      describeSettings(settings),
      "Search returns 20, the reranker scores 10, the prompt keeps 4.",
    );
    assert.equal(
      describeSettings({ ...settings, threshold: 0.001 }),
      `Search returns 20, the reranker scores 10, the prompt keeps 4. A best score under 0.001 gets "I don't know."`,
    );
  });

  it("asks for each choice you haven't picked, and the page that picks it", () => {
    assert.throws(
      () => settingsFrom({ ...allSet, RETRIEVAL_K: null }),
      /^Error: Pick RETRIEVAL_K in src\/choices\.ts\. Open guide\/act-3\.html, step 4\.$/,
    );
    for (const name of [
      "RERANK_DEPTH",
      "CHUNKS_KEPT",
      "REFUSAL_INSTRUCTION",
    ] as const) {
      assert.throws(
        () => settingsFrom({ ...allSet, [name]: null }),
        new RegExp(
          `^Error: Pick ${name} in src/choices\\.ts\\. Open guide/act-4\\.html, step 4\\.$`,
        ),
      );
    }
  });

  it("looks the asker up in the members file", () => {
    assert.deepEqual(lookUpAsker("Katie"), {
      name: "Katie",
      allowed: ["barovia/party", "toe-wittine/party"],
    });
    assert.deepEqual(lookUpAsker("millie").allowed, ["toe-wittine/party"]);
  });

  it("gives an asker the members file doesn't know nothing, and no asker nothing", () => {
    assert.deepEqual(lookUpAsker("strahd").allowed, []);
    assert.deepEqual(lookUpAsker(undefined).allowed, []);
  });

  it("says who is asking and what they may see", () => {
    assert.equal(
      describeAsker({ name: "katie", allowed: ["barovia/party"] }),
      "Asking as katie, who may see barovia/party.",
    );
    assert.match(
      describeAsker({ name: "strahd", allowed: [] }),
      /^Asking as strahd, whom members\.json allows nothing\./,
    );
    assert.match(
      describeAsker({ name: undefined, allowed: [] }),
      /^Asking as nobody, so members\.json allows nothing\./,
    );
  });

  it("prints a night's citation by its moment and a document's by its name", () => {
    const night: Citation = { night: "barovia-2025-12-01", start_ms: 44_750 };
    assert.equal(formatCitation(night), "barovia-2025-12-01 at 0:00:44");
    assert.equal(
      formatCitation({ document: "barovia-strahd-plan" }),
      "barovia-strahd-plan",
    );
  });

  const kept: Asked["kept"] = [
    {
      night: "barovia-2025-12-01",
      start_ms: 44_750,
      end_ms: 60_000,
      document: null,
      campaign: "barovia",
      visibility: "barovia/party",
      text: "You guys know of Blinsky's Toys.",
      distance: 0.4,
      score: 0.98765,
    },
    {
      night: null,
      start_ms: null,
      end_ms: null,
      document: "barovia-strahd-plan",
      campaign: null,
      visibility: "barovia/dm",
      text: "Strahd's plan.",
      distance: 0.6,
      score: 0.0000346,
    },
  ];
  const asked: Asked = {
    text: "Blinsky sells toys.",
    citations: [{ night: "barovia-2025-12-01", start_ms: 44_750 }],
    asker: { name: "katie", allowed: [] },
    gated: false,
    kept,
    ranked: kept,
  };

  it("prints the answer, what it cites, and the chunks in the prompt with their scores, however small", () => {
    assert.deepEqual(formatAsked(asked), [
      "Blinsky sells toys.",
      "",
      "Cited:",
      "  barovia-2025-12-01 at 0:00:44",
      "",
      "The 2 chunks in the prompt, best first:",
      " 1  0.99      barovia-2025-12-01 at 0:00:44  barovia/party",
      " 2  0.000035  barovia-strahd-plan  barovia/dm",
    ]);
  });

  it("says when the relevance gate answered and the model wasn't asked", () => {
    assert.deepEqual(
      formatAsked({
        ...asked,
        text: "I don't know.",
        citations: [],
        gated: true,
      }).slice(0, 6),
      [
        "I don't know.",
        "",
        "Cited: nothing.",
        "",
        "The best score is under your threshold, so the model wasn't asked.",
        "The 2 chunks the prompt would have held, best first:",
      ],
    );
  });

  it("says so when the answer cites nothing", () => {
    assert.equal(
      formatAsked({ ...asked, citations: [] })[2],
      "Cited: nothing.",
    );
  });
});
