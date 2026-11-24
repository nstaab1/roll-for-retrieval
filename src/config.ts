// Every model the workshop calls, where the hosted ones live, and what each
// costs. The December re-pin changes ids and prices here, together.
import { reranker, type WhisperModel } from "./local-models.ts";

export type ProviderName = "openrouter" | "openai";

export interface Provider {
  label: string;
  keyName: string;
  baseURL: string;
}

// Whichever key is set picks the provider. OpenRouter comes first because
// pre-work names it, and it is the only one with the hosted reranker.
export const providers: Record<ProviderName, Provider> = {
  openrouter: {
    label: "OpenRouter",
    keyName: "OPENROUTER_API_KEY",
    baseURL: "https://openrouter.ai/api/v1",
  },
  openai: {
    label: "OpenAI",
    keyName: "OPENAI_API_KEY",
    baseURL: "https://api.openai.com/v1",
  },
};

// Hosted model ids are written the way OpenRouter names them. On an OpenAI key
// the `openai/` prefix comes off. A model without that prefix runs on
// OpenRouter only.
export const models = {
  hostedTranscription: "openai/gpt-transcribe",
  embedding: "openai/text-embedding-3-small",
  answer: "openai/gpt-4o-mini",
  localTranscription: "base.en" satisfies WhisperModel,
  // Offered on the Act 1 page as the slower, better choice.
  localTranscriptionSlower: "small.en" satisfies WhisperModel,
  localReranker: reranker.id,
} as const;

// The swaps `npm run eval -- --swap <name>` tries, each in place of one model
// above. The newer answer model is provisional until the December re-pin.
export const swaps = {
  "large-embedding": {
    replaces: "embedding",
    model: "openai/text-embedding-3-large",
  },
  "hosted-reranker": { replaces: "localReranker", model: "cohere/rerank-v3.5" },
  "newer-answer": { replaces: "answer", model: "openai/gpt-5-mini" },
} as const;

// Dollars per unit, read from OpenRouter's model list on 2026-11-04. OpenAI
// charges the same for its own models. The cost log prices every call from
// this table, never from what the provider reports.
export interface Price {
  perMillionInputTokens?: number;
  perMillionOutputTokens?: number;
  perAudioMinute?: number;
  perSearch?: number;
}

export const prices: Record<string, Price> = {
  "openai/gpt-transcribe": { perAudioMinute: 0.0045 },
  "openai/text-embedding-3-small": { perMillionInputTokens: 0.02 },
  "openai/text-embedding-3-large": { perMillionInputTokens: 0.13 },
  "openai/gpt-4o-mini": {
    perMillionInputTokens: 0.15,
    perMillionOutputTokens: 0.6,
  },
  "openai/gpt-5-mini": {
    perMillionInputTokens: 0.25,
    perMillionOutputTokens: 2,
  },
  "cohere/rerank-v3.5": { perSearch: 0.001 },
};

// GitHub's rate for the 4-core codespace the workshop runs on. The cost
// summary prices local stages' wall seconds at it, so local isn't free.
export const codespaceDollarsPerHour = 0.36;

// The largest file hosted transcription accepts, on both providers: 25 MB.
export const hostedTranscriptionMaxBytes = 25_000_000;
