// The local reranker model, a cross-encoder. It reads the question and one
// chunk together and scores how well the chunk answers the question, from 0
// to 1. It runs on the codespace's CPU through Transformers.js, needs no key,
// and writes each call to the cost log at $0. The eval's hosted-reranker swap
// sends the same question and chunks to a hosted reranker instead.
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
} from "@huggingface/transformers";
import { runLocal } from "./cost-log.ts";
import { scoreHosted } from "./hosted.ts";
import { reranker, transformersCacheDir } from "./local-models.ts";
import { modelFor } from "./swap.ts";

// The tokenizer and model Transformers.js loads for the reranker.
type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type Loaded = readonly [
  Tokenizer,
  Awaited<
    ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>
  >,
];

// The load in progress or done, shared by every call in this process.
let loading: Promise<Loaded> | undefined;

// Loads the model once per process, from the image's cache only, so a missing
// file fails fast instead of downloading on the room's wifi.
function loadReranker(): Promise<Loaded> {
  env.cacheDir = transformersCacheDir;
  env.allowRemoteModels = false;
  loading ??= Promise.all([
    AutoTokenizer.from_pretrained(reranker.id),
    AutoModelForSequenceClassification.from_pretrained(reranker.id, {
      dtype: reranker.dtype,
    }),
  ] as const).catch((error: unknown) => {
    loading = undefined;
    throw new Error(
      `Can't load the reranker model ${reranker.id} from ${transformersCacheDir}. Run npm run doctor to check it.`,
      { cause: error },
    );
  });
  return loading;
}

// How many chunks go through the model at once. Each one is padded to the
// longest in its batch, so a small batch keeps memory down.
export const scoreBatchSize = 16;

// One score per text, in the order given: how well it answers `question`.
export async function scoreChunks(
  question: string,
  texts: string[],
): Promise<number[]> {
  if (texts.length === 0) return [];
  const swapped = modelFor("localReranker");
  if (swapped !== reranker.id) {
    return scoreHosted(question, texts, { model: swapped });
  }
  const [tokenizer, model] = await loadReranker();

  // The question and each chunk as one input, cut at the model's limit.
  const batches: Array<ReturnType<Tokenizer>> = [];
  let inputTokens = 0;
  for (let i = 0; i < texts.length; i += scoreBatchSize) {
    const batch = texts.slice(i, i + scoreBatchSize);
    const inputs = tokenizer(
      batch.map(() => question),
      { text_pair: batch, padding: true, truncation: true },
    );
    for (const used of inputs.attention_mask.data) inputTokens += Number(used);
    batches.push(inputs);
  }

  return runLocal("reranker", reranker.id, { inputTokens }, async () => {
    const scores: number[] = [];
    for (const inputs of batches) {
      const { logits } = await model(inputs);
      for (const logit of logits.data) scores.push(sigmoid(Number(logit)));
    }
    return scores;
  });
}

// The model gives a raw score with no fixed range. This maps it into 0 to 1,
// as the model's own library does.
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
