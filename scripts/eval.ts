// `npm run eval` asks every question in eval-set.json through your whole
// pipeline, as the member the file names, three times each. It prints three
// numbers: the expected source in the top 5 after reranking, the expected
// source cited, and refused when it should. Then it prints what a question
// costs, from the cost log. `npm run eval -- --swap <name>` runs it again with
// one stage's model swapped, leaves src/choices.ts alone, and prints your
// latest baseline beside it. Every run is kept in eval-runs/. A run without a
// swap costs a few tenths of a cent.
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as choices from "../src/choices.ts";
import { lookUpAsker } from "../src/ask.ts";
import { models, providers, swaps } from "../src/config.ts";
import { codespaceDollars, readCostLog } from "../src/cost-log.ts";
import {
  baselineFor,
  evalSetPath,
  loadEvalSet,
  readRuns,
  runEval,
  runsPerQuestion,
  saveRun,
  scoresOf,
  topReach,
  type EvalRun,
  type QuestionResult,
  type Range,
} from "../src/eval.ts";
import {
  findKey,
  modelIdFor,
  noKeyMessage,
  type HostedKey,
} from "../src/hosted.ts";
import { buildIndex } from "../src/ingest.ts";
import {
  countChunks,
  findIndex,
  openStore,
  saveStore,
  type Store,
} from "../src/store.ts";
import {
  modelFor,
  parseSwap,
  swapNames,
  useSwap,
  type SwapName,
} from "../src/swap.ts";
import { formatSmallDollars } from "../src/transcript.ts";
import { describeAsker, describeSettings, settingsFrom } from "./ask.ts";
import { dollarsText, secondsText, table } from "./cost.ts";
import { describeIndex } from "./search.ts";

// Why `swap` can't run on `key`, or undefined when it can. The hosted
// reranker is on OpenRouter only.
export function swapProblem(
  swap: SwapName,
  key: HostedKey | undefined,
): string | undefined {
  if (!key) return noKeyMessage;
  try {
    modelIdFor(key.provider, swaps[swap].model);
    return undefined;
  } catch (error) {
    const others = swapNames.filter((name) => name !== swap).join(" or ");
    return `The ${swap} swap can't run on your ${providers[key.provider].label} key. ${(error as Error).message} Or try ${others}.`;
  }
}

// What a swap changes, as one line.
export function describeSwap(swap: SwapName): string {
  const { replaces, model } = swaps[swap];
  const rebuild =
    replaces === "embedding" ? ", with the index rebuilt to match" : "";
  return `Swapping in ${model} for ${models[replaces]}${rebuild}. Your choices stay as they are.`;
}

// Where the large-embedding swap keeps the index it builds, so a second run
// doesn't pay for it again. Git leaves it out.
export const swapIndexFile = (swap: SwapName) => `index/${swap}.tar.gz`;

// The store to ask: your index, or for a swap that replaces the embedding
// model, one built at your index's chunk values with the swap's model. It
// reuses that one when it was built at the same values.
async function storeFor(
  swap: SwapName | undefined,
): Promise<{ file: string; store: Store }> {
  const file = findIndex();
  const store = await openStore(file);
  if (swap === undefined || swaps[swap].replaces !== "embedding") {
    return { file, store };
  }
  const settings = { ...store.settings, model: modelFor("embedding") };
  await store.db.close();
  const swapFile = path.resolve(swapIndexFile(swap));
  if (existsSync(swapFile)) {
    const built = await openStore(swapFile);
    if (
      built.settings.chunkSize === settings.chunkSize &&
      built.settings.chunkOverlap === settings.chunkOverlap &&
      built.settings.model === settings.model
    ) {
      return { file: swapFile, store: built };
    }
    await built.db.close();
  }
  console.log(
    `Building ${swapIndexFile(swap)} at chunk size ${settings.chunkSize}, overlap ${settings.chunkOverlap}, with ${settings.model}.`,
  );
  const logged = readCostLog().length;
  const built = await buildIndex(settings);
  await saveStore(built, swapFile);
  const dollars = readCostLog()
    .slice(logged)
    .reduce((sum, line) => sum + line.dollars, 0);
  console.log(
    `Saved it for ${dollarsText(dollars)}. The next ${swap} run reuses it.\n`,
  );
  return { file: swapFile, store: built };
}

// A count over the runs: one number when every run agreed, a range when the
// runs differ.
export function rangeText({ min, max }: Range, of: number): string {
  return min === max ? `${min} of ${of}` : `${min} to ${max} of ${of}`;
}

// How many of a question's runs passed, such as "2/3".
const passed = (results: Array<boolean | null>) =>
  `${results.filter(Boolean).length}/${results.length}`;

// One question's runs as a line, printed as it finishes.
export function describeQuestion(
  { question, source, outcomes }: QuestionResult,
  place: number,
  of: number,
): string {
  const where = `${String(place).padStart(String(of).length)}/${of}`;
  const scores =
    source === null
      ? `refused ${passed(outcomes.map((o) => o.refused))}`
      : `top ${topReach} ${passed(outcomes.map((o) => o.inTop))}, cited ${passed(outcomes.map((o) => o.cited))}`;
  return `${where}  ${scores}  ${question}`;
}

// Runs side by side, a column each: the three numbers, then what a question
// cost.
export function formatComparison(columns: Array<[string, EvalRun]>): string[] {
  const scored = columns.map(([label, run]) => ({
    label,
    run,
    scores: scoresOf(run.questions),
  }));
  const perQuestion = (run: EvalRun, value: number) =>
    run.cost.asks === 0 ? 0 : value / run.cost.asks;
  const lines = table([
    ["", ...scored.map((c) => c.label)],
    [
      `Expected source in the top ${topReach}`,
      ...scored.map((c) => rangeText(c.scores.inTop, c.scores.answerable)),
    ],
    [
      "Expected source cited",
      ...scored.map((c) => rangeText(c.scores.cited, c.scores.answerable)),
    ],
    [
      "Refused when it should",
      ...scored.map((c) => rangeText(c.scores.refused, c.scores.unanswerable)),
    ],
    [
      "Hosted cost a question",
      ...scored.map((c) =>
        formatSmallDollars(perQuestion(c.run, c.run.cost.dollars)),
      ),
    ],
    [
      "Local time a question",
      ...scored.map((c) => {
        const seconds = perQuestion(c.run, c.run.cost.localSeconds);
        return `${secondsText(seconds)}, ${formatSmallDollars(codespaceDollars(seconds))}`;
      }),
    ],
  ]);
  const varied = scored.some((c) => c.scores.inTop.min !== c.scores.inTop.max);
  const runs = Math.max(
    ...scored.flatMap((c) => c.run.questions.map((q) => q.outcomes.length)),
  );
  return [
    ...lines,
    "",
    varied
      ? `The top ${topReach} changed between runs, so this reranker doesn't score the same chunks the same way every time.`
      : `The top ${topReach} is the same every run: search and the reranker don't sample.`,
    `Cited and refused can change, because the answer model samples its words. A range is the lowest and highest over ${runs} runs.`,
    "The citation check reads the citations, never the answer's text.",
  ];
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { swap: { type: "string" } } });
    const swap = values.swap === undefined ? undefined : parseSwap(values.swap);
    const set = loadEvalSet(evalSetPath());
    const settings = settingsFrom(choices);
    if (swap !== undefined) {
      const problem = swapProblem(swap, findKey());
      if (problem) throw new Error(problem);
      useSwap(swap);
    }
    const { file, store } = await storeFor(swap);
    try {
      console.log(describeAsker(lookUpAsker(set.asker)));
      console.log(
        describeIndex(
          path.relative(process.cwd(), file),
          await countChunks(store),
          store.settings,
        ),
      );
      console.log(describeSettings(settings));
      if (swap !== undefined) console.log(describeSwap(swap));
      console.log(
        `\nAsking ${set.questions.length} questions ${runsPerQuestion} times each.\n`,
      );
      const at = new Date().toISOString();
      const { questions, cost } = await runEval(store, set, settings, {
        onQuestion: (result, place, of) =>
          console.log(describeQuestion(result, place, of)),
      });
      const run: EvalRun = {
        at,
        swap: swap ?? null,
        asker: set.asker,
        settings,
        index: store.settings,
        questions,
        cost,
      };
      const baseline =
        swap === undefined ? undefined : baselineFor(run, readRuns());
      const saved = saveRun(run);
      const columns: Array<[string, EvalRun]> = baseline
        ? [
            ["Baseline", baseline],
            [swap!, run],
          ]
        : [[swap ?? "Baseline", run]];
      console.log(`\n${formatComparison(columns).join("\n")}`);
      if (swap !== undefined && !baseline) {
        console.log(
          "No baseline at these choices yet. Run npm run eval to get one, then run the swap again to see them side by side.",
        );
      }
      console.log(`\nSaved to ${path.relative(process.cwd(), saved)}.`);
    } finally {
      await store.db.close();
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
