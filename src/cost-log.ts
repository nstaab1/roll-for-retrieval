// The cost log: one JSON line per call the pipeline makes, hosted or local.
// Every shipped client writes it, so no act writes logging code.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { codespaceDollarsPerHour, prices, type Price } from "./config.ts";
import { reranker, whisperModels } from "./local-models.ts";

export type Stage =
  | "local-transcription"
  | "hosted-transcription"
  | "embedding"
  | "reranker"
  | "chat";

// How much went into a call: tokens for text, seconds for audio, searches for
// a hosted reranker.
export interface InputSize {
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  searches?: number;
}

export interface CostLine extends InputSize {
  at: string;
  stage: Stage;
  model: string;
  dollars: number;
  seconds: number;
  // Set on calls a test run made, so the cost summary can leave them out.
  test?: true;
}

// How each part of an input size is priced: the price field that covers it,
// and how many of the size's units that price is for.
interface Unit {
  size: keyof InputSize;
  price: keyof Price;
  per: number;
  name: string;
}

const units: Unit[] = [
  {
    size: "inputTokens",
    price: "perMillionInputTokens",
    per: 1_000_000,
    name: "input token",
  },
  {
    size: "outputTokens",
    price: "perMillionOutputTokens",
    per: 1_000_000,
    name: "output token",
  },
  {
    size: "audioSeconds",
    price: "perAudioMinute",
    per: 60,
    name: "audio second",
  },
  { size: "searches", price: "perSearch", per: 1, name: "search" },
];

// Dollars for one hosted call, from the price table in src/config.ts.
export function dollarsFor(model: string, size: InputSize): number {
  const price = prices[model];
  if (!price) {
    throw new Error(
      `${model} has no price. Add it to the price table in src/config.ts.`,
    );
  }
  let dollars = 0;
  for (const { size: sizeKey, price: priceKey, per, name } of units) {
    const amount = size[sizeKey];
    if (amount === undefined) continue;
    const rate = price[priceKey];
    if (rate === undefined) {
      throw new Error(
        `${model} has no price per ${name} in src/config.ts, but the call reported ${amount}.`,
      );
    }
    dollars += (amount / per) * rate;
  }
  return dollars;
}

// The log lives in the folder the command runs from, which npm makes the repo
// root. A test can point COST_LOG at a scratch file instead.
export function costLogPath(): string {
  return process.env.COST_LOG || path.resolve("cost-log.jsonl");
}

// One call, as the log records it. The time and the test-run mark are added
// when it is written.
export type Call = Omit<CostLine, "at" | "test">;

export function writeCostLine(call: Call): void {
  const line: CostLine = {
    at: new Date().toISOString(),
    ...call,
    ...(process.env.COST_LOG_TEST === "1" ? { test: true } : {}),
  };
  appendFileSync(costLogPath(), `${JSON.stringify(line)}\n`);
}

// Times `work` and logs it once it succeeds. Local stages cost $0 here; the
// cost summary prices their wall seconds at the codespace's hourly rate.
export async function runLocal<T>(
  stage: Stage,
  model: string,
  size: InputSize,
  work: () => T | Promise<T>,
): Promise<T> {
  const started = performance.now();
  const result = await work();
  const seconds = elapsedSince(started);
  writeCostLine({ stage, model, ...size, dollars: 0, seconds });
  return result;
}

export function elapsedSince(started: number): number {
  return (performance.now() - started) / 1000;
}

export function readCostLog(file: string = costLogPath()): CostLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CostLine);
}

// The models that run on the codespace's own CPU.
const localModels = new Set<string>([
  ...Object.keys(whisperModels),
  reranker.id,
]);

// Whether a line is a local stage's: $0 in the log, but not free.
export function isLocal(line: CostLine): boolean {
  return localModels.has(line.model);
}

// What `seconds` of the codespace cost at GitHub's hourly rate.
export function codespaceDollars(seconds: number): number {
  return (seconds / 3600) * codespaceDollarsPerHour;
}
