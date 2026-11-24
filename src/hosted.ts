// The one client for every hosted call: transcription, embeddings, chat and
// the eval's hosted reranker. It reads the key, picks the provider from it,
// and writes each call to the cost log.
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import {
  hostedTranscriptionMaxBytes,
  models,
  providers,
  type ProviderName,
} from "./config.ts";
import {
  dollarsFor,
  elapsedSince,
  writeCostLine,
  type InputSize,
  type Stage,
} from "./cost-log.ts";
import { modelFor } from "./swap.ts";

export interface HostedKey {
  provider: ProviderName;
  key: string;
  from: "environment" | ".env";
}

export const noKeyMessage =
  "No hosted key. Copy .env.example to .env and put your key in it, then run npm run doctor to check it.";

const providerOrder: ProviderName[] = ["openrouter", "openai"];

// The environment wins over .env, so a Codespaces secret beats the file.
export function findKey(
  env: NodeJS.ProcessEnv = process.env,
  envFile: string = path.resolve(".env"),
): HostedKey | undefined {
  const fromFile = existsSync(envFile)
    ? parseEnv(readFileSync(envFile, "utf8"))
    : {};
  const sources: Array<
    [HostedKey["from"], Record<string, string | undefined>]
  > = [
    ["environment", env],
    [".env", fromFile],
  ];
  for (const [from, values] of sources) {
    for (const provider of providerOrder) {
      const key = values[providers[provider].keyName]?.trim();
      if (key) return { provider, key, from };
    }
  }
  return undefined;
}

// Model ids in src/config.ts are OpenRouter's. OpenAI names its own models
// without the vendor prefix and has no one else's.
export function modelIdFor(provider: ProviderName, model: string): string {
  if (provider === "openrouter") return model;
  if (model.startsWith("openai/")) return model.slice("openai/".length);
  throw new Error(
    `${model} runs on OpenRouter only. Put an OpenRouter key in .env to use it.`,
  );
}

let cached: { key: string; client: OpenAI; provider: ProviderName } | undefined;

function connect(): { client: OpenAI; provider: ProviderName } {
  const found = findKey();
  if (!found) throw new Error(noKeyMessage);
  if (cached?.key !== found.key) {
    const client = new OpenAI({
      apiKey: found.key,
      baseURL: providers[found.provider].baseURL,
    });
    cached = { key: found.key, client, provider: found.provider };
  }
  return cached;
}

// Runs one hosted call, then logs it at the price table's rate. The hosted
// twin of runLocal in src/cost-log.ts.
async function runHosted<T>(
  stage: Stage,
  model: string,
  call: (client: OpenAI, modelId: string) => Promise<T>,
  sizeOf: (result: T) => InputSize,
): Promise<T> {
  const { client, provider } = connect();
  const modelId = modelIdFor(provider, model);
  const started = performance.now();
  const result = await call(client, modelId);
  const seconds = elapsedSince(started);
  const size = sizeOf(result);
  writeCostLine({
    stage,
    model,
    ...size,
    dollars: dollarsFor(model, size),
    seconds,
  });
  return result;
}

export interface ModelOption {
  model?: string;
}

// One vector per text, in the order given.
export async function embed(
  texts: string[],
  { model = models.embedding }: ModelOption = {},
): Promise<number[][]> {
  const response = await runHosted(
    "embedding",
    model,
    (client, id) => client.embeddings.create({ model: id, input: texts }),
    (r) => ({ inputTokens: r.usage?.prompt_tokens ?? estimateTokens(texts) }),
  );
  return response.data
    .toSorted((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export type ChatOptions = ModelOption &
  Omit<ChatCompletionCreateParamsNonStreaming, "model" | "messages">;

// The reply's text, from the answer model, or the eval's swap for it. Extra
// options, such as `response_format`, go straight to the provider.
export async function chat(
  messages: ChatCompletionMessageParam[],
  { model = modelFor("answer"), ...options }: ChatOptions = {},
): Promise<string> {
  const response = await runHosted(
    "chat",
    model,
    (client, id) =>
      client.chat.completions.create({ ...options, model: id, messages }),
    (r) => ({
      inputTokens:
        r.usage?.prompt_tokens ??
        estimateTokens(messages.map((m) => JSON.stringify(m.content ?? ""))),
      outputTokens:
        r.usage?.completion_tokens ??
        estimateTokens([r.choices[0]?.message.content ?? ""]),
    }),
  );
  return response.choices[0]?.message.content ?? "";
}

// What OpenRouter's rerank route returns: a score per text it was sent,
// best first, each naming the text's place in the list.
interface RerankResponse {
  results: Array<{ index: number; relevance_score: number }>;
  usage?: { search_units?: number };
}

// One score per text, in the order given, from a hosted reranker: how well
// each answers `question`, from 0 to 1. The eval's hosted-reranker swap runs
// it. Only OpenRouter has the route, and the openai client has no method for
// it, so this posts to it directly.
export async function scoreHosted(
  question: string,
  texts: string[],
  { model }: Required<ModelOption>,
): Promise<number[]> {
  const response = await runHosted(
    "reranker",
    model,
    (client, id) =>
      client.post<RerankResponse>("/rerank", {
        body: { model: id, query: question, documents: texts },
      }),
    (r) => ({ searches: r.usage?.search_units ?? 1 }),
  );
  const scores = texts.map(() => 0);
  for (const { index, relevance_score } of response.results) {
    scores[index] = relevance_score;
  }
  return scores;
}

// The text of one audio file. Hosted transcription returns no timestamps.
export async function transcribe(
  file: string,
  { model = models.hostedTranscription }: ModelOption = {},
): Promise<string> {
  const bytes = statSync(file).size;
  if (bytes > hostedTranscriptionMaxBytes) {
    const mb = (bytes / 1_000_000).toFixed(1);
    throw new Error(
      `${file} is ${mb} MB. Hosted transcription takes files up to 25 MB.`,
    );
  }
  const audioSeconds = audioDuration(file);
  const response = await runHosted(
    "hosted-transcription",
    model,
    (client, id) =>
      client.audio.transcriptions.create({
        model: id,
        file: createReadStream(file),
      }),
    () => ({ audioSeconds }),
  );
  return response.text;
}

// Seconds of audio in a file, read by ffprobe, which ships with ffmpeg.
export function audioDuration(file: string): number {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { encoding: "utf8" },
  );
  const seconds = Number(result.stdout.trim());
  if (result.status !== 0 || !Number.isFinite(seconds)) {
    const why = result.error?.message ?? result.stderr.trim();
    throw new Error(`Can't read the length of ${file}: ${why}`);
  }
  return seconds;
}

// Providers report token counts. This covers one that doesn't, at roughly four
// characters a token.
function estimateTokens(texts: string[]): number {
  return Math.ceil(texts.reduce((sum, t) => sum + t.length, 0) / 4);
}
