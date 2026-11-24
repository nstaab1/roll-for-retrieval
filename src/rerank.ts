// Act 4: the reranker. The explainer page has the code: guide/act-4.html
import { scoreChunks } from "./cross-encoder.ts";
import type { Hit } from "./store.ts";

// A hit with the reranker's score: how well it answers the question, from 0
// to 1.
export interface Ranked extends Hit {
  score: number;
}

// The first `depth` hits, each scored against the question by the local
// reranker, best first.
export async function rerank(
  question: string,
  hits: Hit[],
  depth: number,
): Promise<Ranked[]> {
  // #region rerank
  // (1) Only the first `depth` hits get scored. The rest never reach the prompt.
  const scored = hits.slice(0, depth);
  // (2) The reranker reads the question and each chunk together.
  const scores = await scoreChunks(
    question,
    scored.map((hit) => hit.text),
  );
  // (3) Best score first. Vector distance no longer decides the order.
  return scored
    .map((hit, i) => ({ ...hit, score: scores[i] }))
    .toSorted((a, b) => b.score - a.score);
  // #endregion
}
