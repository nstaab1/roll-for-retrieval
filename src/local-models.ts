// Where the workshop image puts the models that run locally. The image sets both
// directories as environment variables; the defaults match it.
import path from "node:path";

export const whisperModelsDir =
  process.env.WHISPER_MODELS_DIR ?? "/opt/whisper/models";

export const whisperModels = {
  "base.en": "ggml-base.en-q5_1.bin",
  "small.en": "ggml-small.en-q5_1.bin",
} as const;

export type WhisperModel = keyof typeof whisperModels;

// How long each model takes per minute of audio on a 4-core codespace, from
// the whisper-codespace-speed research. The transcribe command estimates from
// it, and the Act 1 page quotes it.
export const whisperSecondsPerAudioMinute: Record<WhisperModel, number> = {
  "base.en": 12,
  "small.en": 31,
};

export function whisperModelPath(model: WhisperModel): string {
  return path.join(whisperModelsDir, whisperModels[model]);
}

// Transformers.js caches inside node_modules by default, which `npm ci` wipes,
// so every caller sets `env.cacheDir` to this directory.
export const transformersCacheDir =
  process.env.TRANSFORMERS_CACHE_DIR ?? "/opt/transformers-cache";

export const reranker = {
  id: "Xenova/ms-marco-MiniLM-L-6-v2",
  dtype: "q8",
  // The most tokens it reads at once, question and chunk together. The chunk
  // sizes the Act 2 page offers stay under it.
  maxInputTokens: 512,
  files: [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "onnx/model_quantized.onnx",
  ],
} as const;

export function rerankerFilePaths(): string[] {
  return reranker.files.map((file) =>
    path.join(transformersCacheDir, reranker.id, file),
  );
}
