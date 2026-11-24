// `npm run ask -- "<question>"` asks your pipeline a question and prints the
// answer, the sources it cited, and the chunks the prompt held with their
// reranker scores. Once you pick a relevance threshold, it says when the gate
// answered instead of the model. `--user <name>` asks as a member of
// members.json. It searches your index once `npm run ingest` has built one,
// and the shipped index before. One embedding call and one answer call, for a few hundredths
// of a cent.
import path from "node:path";
import { parseArgs } from "node:util";
import * as choices from "../src/choices.ts";
import { formatCitation, sourceOf } from "../src/citation.ts";
import {
  ask,
  lookUpAsker,
  type AskSettings,
  type Asked,
  type Asker,
} from "../src/ask.ts";
import { dontKnow } from "../src/gate.ts";
import { membersFileName } from "../src/members.ts";
import { countChunks, findIndex, openStore } from "../src/store.ts";
import { describeIndex } from "./search.ts";

// The five choices the pipeline reads from src/choices.ts.
type AskChoices = Pick<
  typeof choices,
  | "RETRIEVAL_K"
  | "RERANK_DEPTH"
  | "CHUNKS_KEPT"
  | "REFUSAL_INSTRUCTION"
  | "RELEVANCE_THRESHOLD"
>;

// Your Act 3 and Act 4 choices, and your relevance threshold once you pick
// it. Throws, naming the first act choice unset and the step that picks it.
export function settingsFrom({
  RETRIEVAL_K,
  RERANK_DEPTH,
  CHUNKS_KEPT,
  REFUSAL_INSTRUCTION,
  RELEVANCE_THRESHOLD,
}: AskChoices): AskSettings {
  for (const [name, value, page] of [
    ["RETRIEVAL_K", RETRIEVAL_K, "act-3"],
    ["RERANK_DEPTH", RERANK_DEPTH, "act-4"],
    ["CHUNKS_KEPT", CHUNKS_KEPT, "act-4"],
    ["REFUSAL_INSTRUCTION", REFUSAL_INSTRUCTION, "act-4"],
  ] as const) {
    if (value === null) {
      throw new Error(
        `Pick ${name} in src/choices.ts. Open guide/${page}.html, step 4.`,
      );
    }
  }
  return {
    k: RETRIEVAL_K!,
    depth: RERANK_DEPTH!,
    kept: CHUNKS_KEPT!,
    refusal: REFUSAL_INSTRUCTION!,
    ...(RELEVANCE_THRESHOLD !== null && { threshold: RELEVANCE_THRESHOLD }),
  };
}

// Search, rerank and prompt sizes, and the relevance gate once there is one.
export function describeSettings({
  k,
  depth,
  kept,
  threshold,
}: AskSettings): string {
  const sizes = `Search returns ${k}, the reranker scores ${depth}, the prompt keeps ${kept}.`;
  return threshold === undefined
    ? sizes
    : `${sizes} A best score under ${threshold} gets "${dontKnow}"`;
}

// A reranker score with two significant figures, so a tiny one still shows.
export const formatScore = (score: number) => score.toPrecision(2);

// Who is asking and what the members file lets them see.
export function describeAsker({ name, allowed }: Asker): string {
  if (name === undefined) {
    return `Asking as nobody, so ${membersFileName} allows nothing.`;
  }
  if (allowed.length === 0) {
    return `Asking as ${name}, whom ${membersFileName} allows nothing.`;
  }
  return `Asking as ${name}, who may see ${allowed.join(", ")}.`;
}

// The answer, what it cites, and what the prompt held, or would have held when
// the relevance gate answered.
export function formatAsked({ text, citations, kept, gated }: Asked): string[] {
  const lines = [text, ""];
  if (citations.length === 0) lines.push("Cited: nothing.");
  else {
    lines.push("Cited:");
    for (const citation of citations) {
      lines.push(`  ${formatCitation(citation)}`);
    }
  }
  if (gated) {
    lines.push(
      "",
      "The best score is under your threshold, so the model wasn't asked.",
      `The ${kept.length} chunks the prompt would have held, best first:`,
    );
  } else {
    lines.push("", `The ${kept.length} chunks in the prompt, best first:`);
  }
  const width = Math.max(
    ...kept.map((chunk) => formatScore(chunk.score).length),
  );
  for (const [i, chunk] of kept.entries()) {
    lines.push(
      `${String(i + 1).padStart(2)}  ${formatScore(chunk.score).padEnd(width)}  ${sourceOf(chunk)}  ${chunk.visibility}`,
    );
  }
  return lines;
}

if (import.meta.main) {
  try {
    const { values, positionals } = parseArgs({
      options: { user: { type: "string" } },
      allowPositionals: true,
    });
    const question = positionals.join(" ").trim();
    if (question === "") {
      throw new Error(
        'Ask something: npm run ask -- --user katie "What does Blinsky sell?"',
      );
    }
    const settings = settingsFrom(choices);
    const asker = lookUpAsker(values.user);
    const file = findIndex();
    const store = await openStore(file);
    try {
      console.log(describeAsker(asker));
      console.log(
        describeIndex(
          path.relative(process.cwd(), file),
          await countChunks(store),
          store.settings,
        ),
      );
      console.log(`${describeSettings(settings)}\n`);
      const asked = await ask(store, question, settings, asker);
      console.log(formatAsked(asked).join("\n"));
    } finally {
      await store.db.close();
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
