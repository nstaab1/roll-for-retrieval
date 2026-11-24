// The presenter's choices, so a checkpoint has values to run at. Yours go in
// src/choices.ts, which catch-up never touches. The tests never read this file.
// DECISIONS.md is where you say why yours differ.

// Act 2: chunking. 600 characters is about 150 tokens, a few exchanges at the
// table. One repeated segment carries a question into the chunk with its
// answer.
export const CHUNK_SIZE = 600;
export const CHUNK_OVERLAP = 1;

// Act 3: retrieval. Twenty chunks is a wide net for Act 4's reranker to sort.
export const RETRIEVAL_K = 20;

// Act 4: reranking and the answer. The reranker scores half of what search
// returns, and the prompt keeps the best four, enough for a fact told across
// a few exchanges.
export const RERANK_DEPTH = 10;
export const CHUNKS_KEPT = 4;
export const REFUSAL_INSTRUCTION =
  "If the sources don't hold the answer, say you don't know and list no sources.";
