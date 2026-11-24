// `npm run quest:similarity [-- "a phrase" "another" ...]` embeds a handful of
// short phrases and prints how close each pair is in meaning, as a grid of
// cosine similarities. It opens Act 3: before you index anything, see what an
// embedding catches and what it misses.
//
// With a key set it embeds the phrases live, for a fraction of a cent. With none it
// prints the grid published with the guide and says so. The similarity grid
// page shows that same grid.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { models, prices } from "../src/config.ts";
import { embed, findKey, noKeyMessage } from "../src/hosted.ts";

// The eight phrases the page compares. Each one tests a different thing an
// embedding can catch: a name and what it names (Blinsky, the toymaker,
// Blinsky's Toys, a toy shop), a neighbour in the same town that isn't the
// same thing (the blacksmith, the windmill), a name no other phrase touches
// (Morgantha), and real table chatter, from 2025-12-01, that is about none of
// them.
export const phrases = [
  "Blinsky",
  "the toymaker",
  "Blinsky's Toys",
  "a toy shop in town",
  "the blacksmith",
  "the windmill",
  "Morgantha",
  "Pizza, pizza, pizza.",
];

// Phrases and how close each pair is. `scores[i][j]` is the cosine similarity
// of `phrases[i]` and `phrases[j]`, so the grid is mirrored on its diagonal.
export interface Grid {
  model: string;
  phrases: string[];
  scores: number[][];
}

// How close two vectors point, from -1 to 1. It is the dot product over the
// lengths, the same math pgvector runs for `<=>`.
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vectors of ${a.length} and ${b.length} numbers can't be compared.`,
    );
  }
  let dot = 0;
  let lengthA = 0;
  let lengthB = 0;
  for (const [i, x] of a.entries()) {
    dot += x * b[i];
    lengthA += x * x;
    lengthB += b[i] * b[i];
  }
  return dot / Math.sqrt(lengthA * lengthB);
}

// Every pair of `vectors` scored. The order matches `phrases`.
export function gridOf(
  phrases: string[],
  vectors: number[][],
  model: string,
): Grid {
  const scores = vectors.map((a) => vectors.map((b) => cosine(a, b)));
  return { model, phrases, scores };
}

// Embeds `texts` live and scores every pair.
export async function embedGrid(
  texts: string[],
  model: string = models.embedding,
): Promise<Grid> {
  return gridOf(texts, await embed(texts, { model }), model);
}

// The score of two phrases in the grid, by the phrases' own text.
export function scoreOf(grid: Grid, a: string, b: string): number {
  const [i, j] = [grid.phrases.indexOf(a), grid.phrases.indexOf(b)];
  if (i < 0 || j < 0) {
    throw new Error(`The grid has no phrase "${i < 0 ? a : b}".`);
  }
  return grid.scores[i][j];
}

// 0.5234 as "0.52", the way the page and the terminal print scores.
export const formatScore = (score: number) => score.toFixed(2);

// The grid as a plain table: a number over each column, and the same number
// and the phrase at the start of each row.
export function formatGrid(grid: Grid): string {
  const label = (text: string) =>
    text.length > 22 ? `${text.slice(0, 21)}…` : text;
  const labels = grid.phrases.map((p, i) => `${i + 1}  ${label(p)}`);
  const width = Math.max(...labels.map((l) => l.length));
  const head = `${" ".repeat(width)}  ${grid.phrases
    .map((_, i) => String(i + 1).padStart(4))
    .join(" ")}`;
  const rows = grid.scores.map(
    (row, i) =>
      `${labels[i].padEnd(width)}  ${row.map((s) => formatScore(s).padStart(4)).join(" ")}`,
  );
  return [head, ...rows].join("\n");
}

// The most embedding the phrases cost, in dollars, at the price table's rate
// and about four characters a token, rounded up to a millionth.
export function liveCostCeiling(texts: string[] = phrases): number {
  const tokens = texts.reduce((sum, t) => sum + t.length, 0) / 4;
  const rate = prices[models.embedding].perMillionInputTokens!;
  return Math.ceil((tokens / 1_000_000) * rate * 1e6) / 1e6;
}

// Where the published grid sits in a workshop checkout, which publish writes.
export const publishedGridPath = () => path.resolve("guide", "similarity.json");

// The grid published with the guide, or undefined when this checkout has none.
export function readPublished(
  file: string = publishedGridPath(),
): Grid | undefined {
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Grid)
    : undefined;
}

const explain =
  "Each number is the cosine similarity of two phrases: 1.00 means the same direction, and the lower the number, the less alike in meaning.";

if (import.meta.main) {
  const asked = process.argv.slice(2).filter((arg) => arg !== "--");
  if (asked.length === 1 || asked.some((p) => p.trim() === "")) {
    console.error(
      `Pass two or more phrases in quotes, such as npm run quest:similarity -- "a toy shop" "the toymaker". Pass none to compare the ${phrases.length} on the page.`,
    );
    process.exitCode = 1;
  } else if (findKey()) {
    const texts = asked.length > 0 ? asked : phrases;
    const grid = await embedGrid(texts);
    console.log(
      `${texts.length} phrases embedded live with ${grid.model}.\n${explain}\n\n${formatGrid(grid)}`,
    );
  } else if (asked.length > 0) {
    console.error(`Your own phrases need a key to embed. ${noKeyMessage}`);
    process.exitCode = 1;
  } else {
    const published = readPublished();
    if (!published) {
      console.error(
        `No hosted key, and no published grid in this checkout. ${noKeyMessage}`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `No hosted key, so this is the published grid, embedded ahead of time with ${published.model}. Add a key to .env to embed live, or to try phrases of your own.\n${explain}\n\n${formatGrid(published)}`,
      );
    }
  }
}
