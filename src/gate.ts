// The last hour: the relevance gate. The explainer page has the code:
// guide/fix-hallucination.html
import type { Ranked } from "./rerank.ts";

// What ask says when the gate stops a question. The model is never called.
export const dontKnow = "I don't know.";

// Whether the best of the reranked chunks scores at least `threshold`. When
// none does, ask answers "I don't know" without calling the model.
export function passesGate(ranked: Ranked[], threshold: number): boolean {
  // #region passesGate
  // (1) The reranker's best score: how well the best chunk answers the
  // question. Vector distance only says how near it sits.
  const best = Math.max(...ranked.map((chunk) => chunk.score));
  // (2) Under your threshold, even the best chunk doesn't answer it.
  return best >= threshold;
  // #endregion
}
