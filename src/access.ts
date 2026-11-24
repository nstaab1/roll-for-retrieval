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
  // Not added yet. Open guide/fix-access-leak.html, step 4. Until then,
  // this is Act 3's search, and every chunk can reach every asker.
  return search(store, question, k);
}
