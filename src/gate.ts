// The last hour: the relevance gate. The explainer page has the code:
// guide/fix-hallucination.html
import type { Ranked } from "./rerank.ts";

// What ask says when the gate stops a question. The model is never called.
export const dontKnow = "I don't know.";

// Whether the best of the reranked chunks scores at least `threshold`. When
// none does, ask answers "I don't know" without calling the model.
export function passesGate(ranked: Ranked[], threshold: number): boolean {
  throw new Error("Not added yet. Open guide/fix-hallucination.html, step 3.");
}
