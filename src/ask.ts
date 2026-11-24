// Ask: one question through the whole pipeline. Search returns the k chunks
// nearest it that the asker may see, your reranker scores the first `depth` of
// them, the best `kept` go into the prompt, and the answer comes back with its
// citations. Once you pick a relevance threshold, a question whose best chunk
// scores under it gets "I don't know" and never reaches the model.
import { searchVisible } from "./access.ts";
import { generateAnswer, type Answer } from "./answer.ts";
import { buildPrompt } from "./context.ts";
import { dontKnow, passesGate } from "./gate.ts";
import {
  allowedVisibilities,
  loadMembers,
  membersPath,
  type Members,
} from "./members.ts";
import { rerank, type Ranked } from "./rerank.ts";
import type { Store } from "./store.ts";

// Your Act 3 and Act 4 choices, as the pipeline reads them.
export interface AskSettings {
  // How many chunks the search returns.
  k: number;
  // How many of those the reranker scores.
  depth: number;
  // How many of the reranked chunks go into the prompt.
  kept: number;
  // What the model is told to say when the chunks don't hold the answer.
  refusal: string;
  // The lowest best score that still gets an answer. With none, there's no
  // relevance gate.
  threshold?: number;
}

// Who is asking, and the visibilities the members file gives them. A missing
// or unknown member is allowed nothing.
export interface Asker {
  name: string | undefined;
  allowed: string[];
}

// An answer, who asked, and the chunks the prompt held, best first, with their
// reranker scores. A gated answer is the gate's "I don't know", and its chunks
// are the ones the prompt would have held. `ranked` is every chunk the
// reranker scored, best first, which the eval reads its top 5 from.
export interface Asked extends Answer {
  asker: Asker;
  kept: Ranked[];
  ranked: Ranked[];
  gated: boolean;
}

// Looks the asker up in the members file.
export function lookUpAsker(
  name: string | undefined,
  members: Members = loadMembers(membersPath()),
): Asker {
  return { name, allowed: allowedVisibilities(members, name) };
}

// Asks one question as `asker` at `settings` and returns the cited answer.
export async function ask(
  store: Store,
  question: string,
  settings: AskSettings,
  asker: Asker,
): Promise<Asked> {
  // Search only what the asker may see. Until the last hour adds the access
  // filter, that's every chunk.
  const hits = await searchVisible(store, question, settings.k, asker.allowed);
  const ranked = await rerank(question, hits, settings.depth);
  const kept = ranked.slice(0, settings.kept);
  if (
    settings.threshold !== undefined &&
    !passesGate(ranked, settings.threshold)
  ) {
    return { text: dontKnow, citations: [], asker, kept, ranked, gated: true };
  }
  const messages = buildPrompt(question, kept, settings.refusal);
  const answer = await generateAnswer(messages, kept);
  return { ...answer, asker, kept, ranked, gated: false };
}
