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
  // #region buildPrompt
  // (4) Each chunk gets a number and its source, so the answer can point at it.
  const sources = chunks
    .map((chunk, i) => `[${i + 1}] ${sourceOf(chunk)}\n${chunk.text}`)
    .join("\n\n");
  // (5) The rules and your refusal go in the system message, the sources and
  // the question in the user's.
  return [
    { role: "system", content: `${answerRules}\n${refusal}` },
    {
      role: "user",
      content: `Sources:\n\n${sources}\n\nQuestion: ${question}`,
    },
  ];
  // #endregion
}
