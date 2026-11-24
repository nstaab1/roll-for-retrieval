// The last hour: the access filter. The explainer page has the code:
// guide/fix-access-leak.html
import { embed } from "./hosted.ts";
import { search } from "./search.ts";
import { toVector, type Hit, type Store } from "./store.ts";

// The `k` chunks nearest the question among those the asker may see, nearest
// first. `allowed` is the asker's visibilities from the members file, so the
// filter never names a value itself.
export async function searchVisible(
  store: Store,
  question: string,
  k: number,
  allowed: string[],
): Promise<Hit[]> {
  // #region searchVisible
  const [vector] = await embed([question], { model: store.settings.model });
  // (1) Your Act 3 query with one line more. WHERE runs before ORDER BY and
  // LIMIT, so the k nearest are counted among the chunks the asker may see.
  const { rows } = await store.db.query<Hit>(
    `SELECT night, start_ms, end_ms, document, campaign, visibility, text,
            embedding <=> $1 AS distance
     FROM chunks
     WHERE visibility = ANY($3)
     ORDER BY distance
     LIMIT $2`,
    // (2) The asker's visibilities from the members file. The filter names none.
    [toVector(vector), k, allowed],
  );
  return rows;
  // #endregion
}
