// Act 3: the top-k search. The explainer page has the code: guide/act-3.html
import { embed } from "./hosted.ts";
import { toVector, type Hit, type Store } from "./store.ts";

// The `k` chunks whose vectors are nearest the question's, nearest first.
export async function search(
  store: Store,
  question: string,
  k: number,
): Promise<Hit[]> {
  // #region search
  // (6) Embed the question with the model that built the index.
  const [vector] = await embed([question], { model: store.settings.model });
  // (7) Nearest first, and only the first k.
  const { rows } = await store.db.query<Hit>(
    `SELECT night, start_ms, end_ms, document, campaign, visibility, text,
            embedding <=> $1 AS distance
     FROM chunks
     ORDER BY distance
     LIMIT $2`,
    [toVector(vector), k],
  );
  return rows;
  // #endregion
}
