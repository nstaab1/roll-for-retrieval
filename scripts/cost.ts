// `npm run cost` sums the cost log by stage and model: every call your
// pipeline has made since Act 1, with the test runs left out. Local stages log
// $0, so the last column prices their wall seconds at the codespace's hourly
// rate. Local isn't free: you pay for it in codespace time. It reads a file
// and calls nothing.
import { codespaceDollarsPerHour } from "../src/config.ts";
import {
  codespaceDollars,
  costLogPath,
  isLocal,
  readCostLog,
  type CostLine,
  type Stage,
} from "../src/cost-log.ts";
import { formatDollars, formatSmallDollars } from "../src/transcript.ts";

// One stage and model's calls, added up.
export interface CostRow {
  stage: Stage;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  audioSeconds: number;
  searches: number;
  dollars: number;
  seconds: number;
  local: boolean;
}

// The order the pipeline runs its stages in, which is the order rows print.
const stageOrder: Stage[] = [
  "local-transcription",
  "hosted-transcription",
  "embedding",
  "reranker",
  "chat",
];

// Every line but the test runs', one row per stage and model, in pipeline
// order.
export function summarize(lines: CostLine[]): CostRow[] {
  const rows = new Map<string, CostRow>();
  for (const line of lines) {
    if (line.test) continue;
    const key = `${line.stage} ${line.model}`;
    const row = rows.get(key) ?? {
      stage: line.stage,
      model: line.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      audioSeconds: 0,
      searches: 0,
      dollars: 0,
      seconds: 0,
      local: isLocal(line),
    };
    row.calls += 1;
    row.inputTokens += line.inputTokens ?? 0;
    row.outputTokens += line.outputTokens ?? 0;
    row.audioSeconds += line.audioSeconds ?? 0;
    row.searches += line.searches ?? 0;
    row.dollars += line.dollars;
    row.seconds += line.seconds;
    rows.set(key, row);
  }
  return [...rows.values()].toSorted(
    (a, b) =>
      stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage) ||
      a.model.localeCompare(b.model),
  );
}

const withCommas = (n: number) => Math.round(n).toLocaleString("en-US");

// What went into a row's calls: tokens, audio or searches.
function inputOf(row: CostRow): string {
  const parts: string[] = [];
  if (row.outputTokens > 0) {
    parts.push(
      `${withCommas(row.inputTokens)} in, ${withCommas(row.outputTokens)} out tokens`,
    );
  } else if (row.inputTokens > 0) {
    parts.push(`${withCommas(row.inputTokens)} tokens`);
  }
  if (row.audioSeconds > 0) {
    parts.push(`${withCommas(row.audioSeconds)} s of audio`);
  }
  if (row.searches > 0) parts.push(`${withCommas(row.searches)} searches`);
  return parts.join(", ");
}

// Dollars to the tenth of a cent, or finer when that would round to nothing.
export function dollarsText(dollars: number): string {
  return dollars > 0 && dollars < 0.001
    ? formatSmallDollars(dollars)
    : formatDollars(dollars);
}

// Seconds with one decimal, since a reranker call takes under one.
export const secondsText = (seconds: number) => `${seconds.toFixed(1)} s`;

// Rows of cells as lines, each column as wide as its widest cell.
export function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((row) => (row[i] ?? "").length)),
  );
  return rows.map((row) =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i])))
      .join("  ")
      .trimEnd(),
  );
}

// The heading of the column that prices local seconds.
export const localColumn = `Local at $${codespaceDollarsPerHour}/h`;

// The summary as lines for the terminal.
export function formatSummary(lines: CostLine[]): string[] {
  const testCalls = lines.filter((line) => line.test).length;
  const rows = summarize(lines);
  const leftOut =
    testCalls > 0
      ? `, leaving out ${testCalls} from test runs`
      : ", none from test runs";
  if (rows.length === 0) {
    return [
      `No calls in the cost log yet${leftOut}. Every command that calls a model adds to it.`,
    ];
  }
  const sum = (pick: (row: CostRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const localSeconds = sum((row) => (row.local ? row.seconds : 0));
  const hosted = sum((row) => row.dollars);
  const local = codespaceDollars(localSeconds);
  const calls = sum((row) => row.calls);
  return [
    `${calls} calls in the cost log${leftOut}.`,
    "",
    ...table([
      ["Stage", "Model", "Calls", "Input", "Dollars", "Wall", localColumn],
      ...rows.map((row) => [
        row.stage,
        row.model,
        String(row.calls),
        inputOf(row),
        dollarsText(row.dollars),
        secondsText(row.seconds),
        row.local ? dollarsText(codespaceDollars(row.seconds)) : "",
      ]),
      [
        "Total",
        "",
        String(calls),
        "",
        dollarsText(hosted),
        secondsText(sum((row) => row.seconds)),
        dollarsText(local),
      ],
    ]),
    "",
    `Hosted calls cost ${dollarsText(hosted)}. The local stages ran ${secondsText(localSeconds)}, which is ${dollarsText(local)} of codespace time at $${codespaceDollarsPerHour} an hour.`,
  ];
}

if (import.meta.main) {
  try {
    console.log(formatSummary(readCostLog(costLogPath())).join("\n"));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
