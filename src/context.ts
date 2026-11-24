// Act 4: context construction, which turns the chunks you kept into the
// prompt. The explainer page has the code: guide/act-4.html
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { sourceOf } from "./citation.ts";
import type { ChunkRow } from "./store.ts";

// What the model is told before every question. Your refusal instruction
// from src/choices.ts goes after it.
export const answerRules =
  "You answer questions about two tabletop campaigns from the numbered sources you're given: transcripts of game nights and the DM's documents. Use only those sources. List the number of every source your answer uses.";

// The messages for one question: the rules and your refusal instruction, then
// every chunk numbered from 1 with its source, then the question.
export function buildPrompt(
  question: string,
  chunks: ChunkRow[],
  refusal: string,
): ChatCompletionMessageParam[] {
  throw new Error("Not added yet. Open guide/act-4.html, step 2.");
}
