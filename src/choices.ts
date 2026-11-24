// Your choices. Each act asks you to fill some in, and every one starts as null.
// The tests never check these values. DECISIONS.md is where you say why you picked them.

// Act 2: chunking.
// Most characters in one chunk. A token is about 4 characters.
export const CHUNK_SIZE: number | null = null;
// Segments repeated from the end of one chunk at the start of the next.
export const CHUNK_OVERLAP: number | null = null;

// Act 3: retrieval.
// How many chunks the vector search returns.
export const RETRIEVAL_K: number | null = null;

// Act 4: reranking and the answer.
// How many of the retrieved chunks the reranker scores.
export const RERANK_DEPTH: number | null = null;
// How many reranked chunks go into the prompt.
export const CHUNKS_KEPT: number | null = null;
// What the model is told to say when the chunks don't hold the answer.
export const REFUSAL_INSTRUCTION: string | null = null;

// The last hour: hallucinated NPCs.
// The lowest reranker score that still gets an answer. Below it, "I don't know".
export const RELEVANCE_THRESHOLD: number | null = null;
