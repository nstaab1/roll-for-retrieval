// Act 3: the top-k search. The explainer page has the code: guide/act-3.html
import { embed } from "./hosted.ts";
import { toVector, type Hit, type Store } from "./store.ts";

// The `k` chunks whose vectors are nearest the question's, nearest first.
export async function search(
  store: Store,
  question: string,
  k: number,
): Promise<Hit[]> {
  throw new Error("Not added yet. Open guide/act-3.html, step 3.");
}
