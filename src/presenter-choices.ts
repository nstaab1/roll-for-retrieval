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
// a few exchanges. The refusal is the one rewritten in the last hour. Act 4's
// gave a different answer to the natural 20 question in each of three runs.
// This one refused it in all three.
export const RERANK_DEPTH = 10;
export const CHUNKS_KEPT = 4;
export const REFUSAL_INSTRUCTION =
  'Answer only from the numbered sources, never from what you know about Dungeons & Dragons or its published adventures. If no source names the person, place or thing the question asks about, or none says the answer outright, answer "I don\'t know." and list no sources.';

// The last hour: hallucinated NPCs. The Madam Eva question's best chunk
// scored about 0.00003, and real answers as low as 0.002, so the gate sits
// between them.
export const RELEVANCE_THRESHOLD = 0.0001;
