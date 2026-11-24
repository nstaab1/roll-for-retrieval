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
  throw new Error("Not added yet. Open guide/act-4.html, step 1.");
}
