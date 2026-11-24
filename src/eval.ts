// The eval: every question in the eval set, asked through your whole pipeline
// as the member the set names, three times each, and scored from what came
// back. It gives three numbers and no model judges any of them: the expected
// source in the top 5 after reranking, the expected source cited, and refused
// when it should. The citation check reads the structured citations, never
// the answer's text, so a lucky phrase can't count.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ask, lookUpAsker, type AskSettings, type Asked } from "./ask.ts";
import type { Citation } from "./citation.ts";
import { isLocal, readCostLog, type CostLine } from "./cost-log.ts";
import type { ChunkRow, IndexSettings, Store } from "./store.ts";
import type { SwapName } from "./swap.ts";

// One question and the source that answers it: a night's id or a document's
// name, as citations print them. A question no source answers has `null`, and
// passes only by refusing.
export interface EvalQuestion {
  question: string;
  source: string | null;
}

// The eval set: the member who asks, and what they ask.
export interface EvalSet {
  asker: string;
  questions: EvalQuestion[];
}

// The shipped eval set, in the folder the command runs from, which npm makes
// the repo root. On your own data, change the asker and the questions.
export const evalSetFileName = "eval-set.json";

// Where the eval set is, from the folder the command runs in.
export function evalSetPath(): string {
  return path.resolve(evalSetFileName);
}

// Reads and checks an eval set. Throws naming the first thing wrong, since a
// typo in a source would quietly fail its question on every run.
export function loadEvalSet(file: string): EvalSet {
  if (!existsSync(file)) {
    throw new Error(
      `No eval set at ${file}. The workshop's is ${evalSetFileName}.`,
    );
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<EvalSet>;
  if (typeof parsed.asker !== "string" || parsed.asker.trim() === "") {
    throw new Error(
      `${file} has no "asker". Name the member who asks every question.`,
    );
  }
  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error(`${file} has no "questions" list.`);
  }
  for (const [i, entry] of parsed.questions.entries()) {
    const { question, source } = (entry ?? {}) as Partial<EvalQuestion>;
    if (
      typeof question !== "string" ||
      question.trim() === "" ||
      !(typeof source === "string" || source === null)
    ) {
      throw new Error(
        `${file}: question ${i + 1} needs a "question" and a "source", the night or document that answers it, or null when nothing does.`,
      );
    }
  }
  return { asker: parsed.asker, questions: parsed.questions };
}

// How many times the eval asks each question. The answer is sampled, so one
// run can't show how much it varies.
export const runsPerQuestion = 3;

// How far down the reranked chunks the expected source can sit and count.
export const topReach = 5;

// One ask of one question, as the eval scores it.
export interface Outcome {
  // Whether the expected source is among the reranker's first 5. Null for a
  // question with no source.
  inTop: boolean | null;
  // Whether a citation names the expected source. Null for a question with
  // no source.
  cited: boolean | null;
  // Whether the answer cites nothing, which is how a refusal shows in the
  // structured citations.
  refused: boolean;
  // Whether the relevance gate answered, so the model was never asked.
  gated: boolean;
  text: string;
  citations: Citation[];
}

// One question and how each of its asks scored.
export interface QuestionResult extends EvalQuestion {
  outcomes: Outcome[];
}

// What the asks cost, from the cost log lines they wrote.
export interface EvalCost {
  asks: number;
  // Hosted dollars, from the price table.
  dollars: number;
  // Wall seconds the local stages ran, which the log prices at $0.
  localSeconds: number;
}

// One whole eval, as eval-runs/ keeps it.
export interface EvalRun {
  at: string;
  swap: SwapName | null;
  asker: string;
  settings: AskSettings;
  index: IndexSettings;
  questions: QuestionResult[];
  cost: EvalCost;
}

// Whether a chunk comes from `source`, a night or a document.
export function isFrom(chunk: ChunkRow, source: string): boolean {
  return chunk.night === source || chunk.document === source;
}

// Whether a citation names `source`, a night or a document.
export function citesSource(citation: Citation, source: string): boolean {
  return "night" in citation
    ? citation.night === source
    : citation.document === source;
}

// Scores one ask of `question`.
export function scoreAsk(
  { source }: EvalQuestion,
  { ranked, citations, gated, text }: Asked,
): Outcome {
  return {
    inTop:
      source === null
        ? null
        : ranked.slice(0, topReach).some((chunk) => isFrom(chunk, source)),
    cited:
      source === null ? null : citations.some((c) => citesSource(c, source)),
    refused: citations.length === 0,
    gated,
    text,
    citations,
  };
}

// The cost of `asks` asks, from the lines they wrote to the cost log.
export function costOf(lines: CostLine[], asks: number): EvalCost {
  let dollars = 0;
  let localSeconds = 0;
  for (const line of lines) {
    dollars += line.dollars;
    if (isLocal(line)) localSeconds += line.seconds;
  }
  return { asks, dollars, localSeconds };
}

// How many times to ask each question, and what to do as each one finishes.
export interface EvalOptions {
  runs?: number;
  // Called as each question finishes, with its place in the set from 1.
  onQuestion?: (result: QuestionResult, place: number, of: number) => void;
}

// Asks every question in `set` `runs` times at `settings`, as the set's
// asker, and scores each ask.
export async function runEval(
  store: Store,
  set: EvalSet,
  settings: AskSettings,
  { runs = runsPerQuestion, onQuestion }: EvalOptions = {},
): Promise<Pick<EvalRun, "questions" | "cost">> {
  const asker = lookUpAsker(set.asker);
  const logged = readCostLog().length;
  const questions: QuestionResult[] = [];
  for (const [i, entry] of set.questions.entries()) {
    const outcomes: Outcome[] = [];
    for (let run = 0; run < runs; run++) {
      const asked = await ask(store, entry.question, settings, asker);
      outcomes.push(scoreAsk(entry, asked));
    }
    const result = { ...entry, outcomes };
    questions.push(result);
    onQuestion?.(result, i + 1, set.questions.length);
  }
  const lines = readCostLog().slice(logged);
  return { questions, cost: costOf(lines, set.questions.length * runs) };
}

// The lowest and highest count over the runs.
export interface Range {
  min: number;
  max: number;
}

// The three numbers. Each is a range over the runs, out of the questions it
// counts: top 5 and cited count the questions with a source, refused counts
// the ones without.
export interface Scores {
  answerable: number;
  unanswerable: number;
  inTop: Range;
  cited: Range;
  refused: Range;
}

// The three numbers for a run's questions.
export function scoresOf(questions: QuestionResult[]): Scores {
  const answerable = questions.filter((q) => q.source !== null);
  const unanswerable = questions.filter((q) => q.source === null);
  const runs = Math.max(...questions.map((q) => q.outcomes.length));
  const rangeOf = (count: (run: number) => number): Range => {
    const counts = Array.from({ length: runs }, (_, run) => count(run));
    return { min: Math.min(...counts), max: Math.max(...counts) };
  };
  const counting =
    (from: QuestionResult[], pass: (o: Outcome) => boolean) => (run: number) =>
      from.filter((q) => q.outcomes[run] && pass(q.outcomes[run])).length;
  return {
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    inTop: rangeOf(counting(answerable, (o) => o.inTop === true)),
    cited: rangeOf(counting(answerable, (o) => o.cited === true)),
    refused: rangeOf(counting(unanswerable, (o) => o.refused)),
  };
}

// Where every run's results are kept, so a swap can print beside your
// baseline. Git leaves the folder out.
export const evalRunsDir = "eval-runs";

// Where the runs are kept, from the folder the command runs in.
export function evalRunsPath(): string {
  return path.resolve(evalRunsDir);
}

// Saves a run under `dir`, named by when it ran and what it swapped. Returns
// the file.
export function saveRun(run: EvalRun, dir: string = evalRunsPath()): string {
  mkdirSync(dir, { recursive: true });
  const stamp = run.at.replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}-${run.swap ?? "baseline"}.json`);
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
  return file;
}

// Every run kept under `dir`, oldest first.
export function readRuns(dir: string = evalRunsPath()): EvalRun[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map(
      (file) =>
        JSON.parse(readFileSync(path.join(dir, file), "utf8")) as EvalRun,
    )
    .toSorted((a, b) => a.at.localeCompare(b.at));
}

// The latest run with no swap that `run` can stand beside: the same choices,
// the same chunk values and the same questions. Undefined when there's none.
export function baselineFor(
  run: EvalRun,
  runs: EvalRun[],
): EvalRun | undefined {
  const asked = (r: EvalRun) => r.questions.map((q) => q.question);
  return runs.findLast(
    (r) =>
      r.swap === null &&
      r.asker === run.asker &&
      isDeepStrictEqual(r.settings, run.settings) &&
      r.index.chunkSize === run.index.chunkSize &&
      r.index.chunkOverlap === run.index.chunkOverlap &&
      isDeepStrictEqual(asked(r), asked(run)),
  );
}
