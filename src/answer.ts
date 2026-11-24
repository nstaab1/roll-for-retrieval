// Act 4: the answer call. The explainer page has the code: guide/act-4.html
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ResponseFormatJSONSchema } from "openai/resources/shared";
import { citationOf, type Citation } from "./citation.ts";
import { chat } from "./hosted.ts";
import type { ChunkRow } from "./store.ts";

// An answer and where its facts came from.
export interface Answer {
  text: string;
  citations: Citation[];
}

// What the model replies with: its answer, and the numbers of the sources it
// used, as buildPrompt numbered them.
export interface CitedReply {
  answer: string;
  sources: number[];
}

// The reply's shape, as a JSON schema. Strict, so the provider holds the model
// to it and the reply always parses.
export const answerFormat: ResponseFormatJSONSchema = {
  type: "json_schema",
  json_schema: {
    name: "cited_answer",
    strict: true,
    schema: {
      type: "object",
      properties: {
        answer: { type: "string" },
        sources: { type: "array", items: { type: "integer" } },
      },
      required: ["answer", "sources"],
      additionalProperties: false,
    },
  },
};

// Asks the model, then turns the source numbers it gave into citations of the
// chunks they label. `chunks` are the ones buildPrompt numbered, in its order.
export async function generateAnswer(
  messages: ChatCompletionMessageParam[],
  chunks: ChunkRow[],
): Promise<Answer> {
  // #region generateAnswer
  // (6) The reply must fit answerFormat: the answer, then the source numbers.
  const reply = await chat(messages, { response_format: answerFormat });
  const { answer, sources }: CitedReply = JSON.parse(reply);
  // (7) Number n labels chunks[n - 1]. A number no chunk carries is dropped.
  const cited = [...new Set(sources)]
    .map((n) => chunks[n - 1])
    .filter((chunk) => chunk !== undefined);
  // (8) Each cited chunk becomes a citation: its night and moment, or its document.
  return { text: answer, citations: cited.map(citationOf) };
  // #endregion
}
