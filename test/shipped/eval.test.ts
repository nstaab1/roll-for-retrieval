// `npm run eval`: reading the eval set, scoring each ask, the three numbers,
// keeping runs, finding the baseline a swap prints beside, and which swaps a
// key can run. These tests need no key and no network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import {
  describeQuestion,
  describeSwap,
  formatComparison,
  rangeText,
  swapProblem,
} from "../../scripts/eval.ts";
import type { Asked } from "../../src/ask.ts";
import type { CostLine } from "../../src/cost-log.ts";
import {
  baselineFor,
  costOf,
  loadEvalSet,
  readRuns,
  saveRun,
  scoreAsk,
  scoresOf,
  type EvalRun,
  type Outcome,
  type QuestionResult,
} from "../../src/eval.ts";
import type { Ranked } from "../../src/rerank.ts";
import { modelFor, parseSwap, useSwap } from "../../src/swap.ts";

function scratch(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "eval-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeSet(t: TestContext, set: unknown): string {
  const file = path.join(scratch(t), "eval-set.json");
  writeFileSync(file, JSON.stringify(set));
  return file;
}

const chunk = (night: string | null, document: string | null): Ranked => ({
  night,
  start_ms: night ? 1000 : null,
  end_ms: night ? 2000 : null,
  document,
  campaign: night ? "barovia" : null,
  visibility: "barovia/party",
  text: "",
  distance: 0.5,
  score: 0.5,
});

// An ask whose reranker put the Dec 1 night sixth, behind five other chunks.
const ranked = [
  ...Array.from({ length: 5 }, () => chunk("barovia-2025-12-23", null)),
  chunk("barovia-2025-12-01", null),
];

const asked = (overrides: Partial<Asked>): Asked => ({
  text: "An answer.",
  citations: [],
  asker: { name: "katie", allowed: [] },
  kept: ranked.slice(0, 4),
  ranked,
  gated: false,
  ...overrides,
});

describe("reading the eval set", () => {
  it("reads the asker and each question with its source, or null", (t) => {
    const set = {
      asker: "katie",
      questions: [
        { question: "Who?", source: "barovia-2025-12-01" },
        { question: "Nobody?", source: null },
      ],
    };
    assert.deepEqual(loadEvalSet(writeSet(t, set)), set);
  });

  it("refuses a set with no asker", (t) => {
    assert.throws(
      () => loadEvalSet(writeSet(t, { questions: [] })),
      /has no "asker"/,
    );
  });

  it("refuses a question with no source, since null has to be written", (t) => {
    assert.throws(
      () =>
        loadEvalSet(
          writeSet(t, { asker: "katie", questions: [{ question: "Who?" }] }),
        ),
      /question 1 needs a "question" and a "source"/,
    );
  });

  it("refuses a missing file, naming the workshop's", () => {
    assert.throws(
      () => loadEvalSet("/nowhere/eval-set.json"),
      /No eval set at .* The workshop's is eval-set\.json\./,
    );
  });
});

describe("scoring one ask", () => {
  const dec1 = { question: "Who?", source: "barovia-2025-12-01" };

  it("counts the expected source in the top 5 only when the reranker put it in the first 5", () => {
    assert.equal(scoreAsk(dec1, asked({})).inTop, false);
    assert.equal(
      scoreAsk(dec1, asked({ ranked: ranked.toReversed() })).inTop,
      true,
    );
  });

  it("counts it cited from the citations, never from the answer's text", () => {
    assert.equal(
      scoreAsk(dec1, asked({ text: "On barovia-2025-12-01, Arabelle." })).cited,
      false,
    );
    assert.equal(
      scoreAsk(
        dec1,
        asked({ citations: [{ night: "barovia-2025-12-01", start_ms: 1000 }] }),
      ).cited,
      true,
    );
  });

  it("matches a document's citation by the document's name", () => {
    const outcome = scoreAsk(
      { question: "Rule?", source: "toe-wittine-ember-ward-rules" },
      asked({ citations: [{ document: "toe-wittine-ember-ward-rules" }] }),
    );
    assert.equal(outcome.cited, true);
  });

  it("counts an answer that cites nothing as refused, and scores top 5 and cited only for a question with a source", () => {
    const outcome = scoreAsk(
      { question: "Session 2?", source: null },
      asked({ text: "I don't know." }),
    );
    assert.equal(outcome.refused, true);
    assert.equal(outcome.inTop, null);
    assert.equal(outcome.cited, null);
  });
});

const outcome = (o: Partial<Outcome>): Outcome => ({
  inTop: true,
  cited: true,
  refused: false,
  gated: false,
  text: "",
  citations: [],
  ...o,
});

// Two answerable questions and one not, three runs each.
const questions: QuestionResult[] = [
  {
    question: "A?",
    source: "barovia-2025-12-01",
    outcomes: [
      outcome({}),
      outcome({ cited: false, refused: true }),
      outcome({}),
    ],
  },
  {
    question: "B?",
    source: "toe-wittine-session-3",
    outcomes: [
      outcome({ inTop: false, cited: false }),
      outcome({ inTop: false, cited: false }),
      outcome({ inTop: false, cited: true }),
    ],
  },
  {
    question: "C?",
    source: null,
    outcomes: [
      outcome({ inTop: null, cited: null, refused: true }),
      outcome({ inTop: null, cited: null, refused: false }),
      outcome({ inTop: null, cited: null, refused: true }),
    ],
  },
];

describe("the three numbers", () => {
  it("counts each run, and gives the lowest and highest over the runs", () => {
    assert.deepEqual(scoresOf(questions), {
      answerable: 2,
      unanswerable: 1,
      inTop: { min: 1, max: 1 },
      cited: { min: 0, max: 2 },
      refused: { min: 0, max: 1 },
    });
  });

  it("prints one number when the runs agree, and a range when they don't", () => {
    assert.equal(rangeText({ min: 6, max: 6 }, 8), "6 of 8");
    assert.equal(rangeText({ min: 5, max: 7 }, 8), "5 to 7 of 8");
  });

  it("prints each question's runs as it finishes", () => {
    assert.equal(
      describeQuestion(questions[0], 1, 10),
      " 1/10  top 5 3/3, cited 2/3  A?",
    );
    assert.equal(
      describeQuestion(questions[2], 10, 10),
      "10/10  refused 2/3  C?",
    );
  });
});

describe("the cost of a question", () => {
  const line = (model: string, dollars: number, seconds: number): CostLine => ({
    at: "2026-11-15T10:00:00.000Z",
    stage: "chat",
    model,
    dollars,
    seconds,
  });

  it("adds the hosted dollars, and the wall seconds of the local stages only", () => {
    assert.deepEqual(
      costOf(
        [
          line("openai/gpt-4o-mini", 0.0002, 1.5),
          line("Xenova/ms-marco-MiniLM-L-6-v2", 0, 0.25),
          line("openai/text-embedding-3-small", 0.000001, 0.3),
        ],
        1,
      ),
      { asks: 1, dollars: 0.000201, localSeconds: 0.25 },
    );
  });
});

const run = (overrides: Partial<EvalRun>): EvalRun => ({
  at: "2026-11-15T10:00:00.000Z",
  swap: null,
  asker: "katie",
  settings: { k: 20, depth: 10, kept: 4, refusal: "Say you don't know." },
  index: {
    chunkSize: 600,
    chunkOverlap: 1,
    model: "openai/text-embedding-3-small",
  },
  questions,
  cost: { asks: 9, dollars: 0.0018, localSeconds: 4.5 },
  ...overrides,
});

describe("keeping runs", () => {
  it("saves each run as its own file and reads them back oldest first", (t) => {
    const dir = scratch(t);
    const later = run({ at: "2026-11-15T11:00:00.000Z", swap: "newer-answer" });
    const file = saveRun(later, dir);
    saveRun(run({}), dir);
    assert.match(
      path.basename(file),
      /^2026-11-15T11-00-00-000Z-newer-answer\.json$/,
    );
    assert.deepEqual(readRuns(dir), [run({}), later]);
  });

  it("finds no runs in a folder that doesn't exist yet", () => {
    assert.deepEqual(readRuns("/nowhere/eval-runs"), []);
  });

  it("pairs a swap with the latest baseline at the same choices, chunk values and questions", () => {
    const swapped = run({
      at: "2026-11-15T12:00:00.000Z",
      swap: "newer-answer",
    });
    const old = run({ at: "2026-11-15T09:00:00.000Z" });
    const latest = run({ at: "2026-11-15T10:00:00.000Z" });
    const otherK = run({
      at: "2026-11-15T11:00:00.000Z",
      settings: { ...latest.settings, k: 30 },
    });
    const otherSwap = run({
      at: "2026-11-15T11:30:00.000Z",
      swap: "hosted-reranker",
    });
    assert.equal(
      baselineFor(swapped, [old, latest, otherK, otherSwap]),
      latest,
    );
  });

  it("pairs the large-embedding swap with a baseline built with the small model at the same chunk values", () => {
    const swapped = run({
      swap: "large-embedding",
      index: { ...run({}).index, model: "openai/text-embedding-3-large" },
    });
    const baseline = run({ at: "2026-11-15T09:00:00.000Z" });
    assert.equal(baselineFor(swapped, [baseline]), baseline);
    assert.equal(
      baselineFor(swapped, [
        run({ index: { ...baseline.index, chunkSize: 300 } }),
      ]),
      undefined,
    );
  });
});

describe("printing runs side by side", () => {
  it("prints the three numbers and the cost a question, a column per run", () => {
    const lines = formatComparison([
      ["Baseline", run({})],
      ["newer-answer", run({ swap: "newer-answer" })],
    ]);
    assert.match(lines[0], /^\s+Baseline\s+newer-answer$/);
    assert.match(lines[1], /^Expected source in the top 5\s+1 of 2\s+1 of 2$/);
    assert.match(lines[2], /^Expected source cited\s+0 to 2 of 2/);
    assert.match(lines[3], /^Refused when it should\s+0 to 1 of 1/);
    assert.match(lines[4], /^Hosted cost a question\s+\$0\.00020/);
    assert.match(lines[5], /^Local time a question\s+0\.5 s, \$0\.00005/);
  });

  it("says the top 5 doesn't vary when no run changed it", () => {
    assert.ok(
      formatComparison([["Baseline", run({})]]).some((line) =>
        line.includes("The top 5 is the same every run"),
      ),
    );
  });
});

describe("a swap", () => {
  it("names the three swaps when asked for one that doesn't exist", () => {
    assert.throws(
      () => parseSwap("bigger-everything"),
      /^Error: There's no swap called "bigger-everything"\. Try large-embedding, hosted-reranker, newer-answer\.$/,
    );
  });

  it("replaces one stage's model for the rest of the run, and the workshop's comes back after", (t) => {
    t.after(() => useSwap(undefined));
    assert.equal(modelFor("answer"), "openai/gpt-4o-mini");
    useSwap("newer-answer");
    assert.equal(modelFor("answer"), "openai/gpt-5-mini");
    assert.equal(modelFor("embedding"), "openai/text-embedding-3-small");
    useSwap(undefined);
    assert.equal(modelFor("answer"), "openai/gpt-4o-mini");
  });

  it("says on an OpenAI key that the hosted reranker needs OpenRouter, and names the swaps that run", () => {
    const openai = { provider: "openai", key: "sk-x", from: ".env" } as const;
    assert.match(
      swapProblem("hosted-reranker", openai)!,
      /^The hosted-reranker swap can't run on your OpenAI key\. cohere\/rerank-v3\.5 runs on OpenRouter only\. .* Or try large-embedding or newer-answer\.$/,
    );
    assert.equal(swapProblem("newer-answer", openai), undefined);
    assert.equal(
      swapProblem("hosted-reranker", {
        provider: "openrouter",
        key: "sk-or-x",
        from: ".env",
      }),
      undefined,
    );
  });

  it("points at .env and the doctor with no key", () => {
    assert.match(swapProblem("newer-answer", undefined)!, /\.env.*doctor/);
  });

  it("says what it swaps, and that the large embedding model rebuilds the index", () => {
    assert.equal(
      describeSwap("large-embedding"),
      "Swapping in openai/text-embedding-3-large for openai/text-embedding-3-small, with the index rebuilt to match. Your choices stay as they are.",
    );
  });
});
