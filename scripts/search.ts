// `npm run search -- "<question>"` prints the RETRIEVAL_K chunks nearest your
// question, nearest first, straight from the vector store. There is no
// reranker and no answer yet. It searches your index once `npm run ingest` has built one, and
// the shipped index before. One embedding call, for a millionth of a dollar.
import path from "node:path";
import * as choices from "../src/choices.ts";
import { sourceOf } from "../src/citation.ts";
import { search } from "../src/search.ts";
import {
  countChunks,
  findIndex,
  openStore,
  type Hit,
  type IndexSettings,
} from "../src/store.ts";

// Your k. Throws, naming the choice, until it is set.
export function kFrom({ RETRIEVAL_K }: Pick<typeof choices, "RETRIEVAL_K">) {
  if (RETRIEVAL_K === null) {
    throw new Error(
      "Pick RETRIEVAL_K in src/choices.ts. Open guide/act-3.html, step 4.",
    );
  }
  return RETRIEVAL_K;
}

const previewLength = 160;

// One hit as two lines: rank, distance, source and visibility, then the start
// of its text.
export function formatHit(hit: Hit, rank: number): string[] {
  const text = hit.text.replace(/\s+/g, " ");
  const cut =
    text.length > previewLength ? `${text.slice(0, previewLength)}…` : text;
  return [
    `${String(rank).padStart(2)}  ${hit.distance.toFixed(3)}  ${sourceOf(hit)}  ${hit.visibility}`,
    `    ${cut}`,
  ];
}

export function describeIndex(
  file: string,
  count: number,
  { chunkSize, chunkOverlap, model }: IndexSettings,
): string {
  return `Searching ${file}: ${count} chunks at chunk size ${chunkSize}, overlap ${chunkOverlap}, embedded with ${model}.`;
}

if (import.meta.main) {
  const question = process.argv.slice(2).join(" ").trim();
  try {
    if (question === "") {
      throw new Error(
        'Ask something: npm run search -- "How did the party destroy the windmill?"',
      );
    }
    const k = kFrom(choices);
    const file = findIndex();
    const store = await openStore(file);
    try {
      const count = await countChunks(store);
      console.log(
        describeIndex(
          path.relative(process.cwd(), file),
          count,
          store.settings,
        ),
      );
      const hits = await search(store, question, k);
      console.log(`The ${k} nearest "${question}", nearest first:\n`);
      for (const [i, hit] of hits.entries()) {
        console.log(formatHit(hit, i + 1).join("\n"));
      }
    } finally {
      await store.db.close();
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
