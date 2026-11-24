// The document loader: reads a folder of written sources, each a Markdown file
// that names its visibility in frontmatter, and refuses any document that
// doesn't. The visibility comes from the frontmatter and nothing else, never
// from a folder or a file name, so an untagged document never reaches the
// vector store. Your chunker stays transcript-only: a document is one chunk,
// or split on paragraphs if it's long.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { chunkSizesToTry } from "./chunk.ts";

// A run of whole paragraphs from one document, and what Act 4 needs to cite it
// and the last hour needs to filter it.
export interface DocumentChunk {
  // The file name without `.md`, which citations print.
  document: string;
  // Who may see it, copied from the document's frontmatter.
  visibility: string;
  // The paragraphs' text, joined by blank lines. This is what gets embedded.
  text: string;
}

// The shipped documents' folder, in the folder the command runs from, which
// npm makes the repo root.
export const documentsDir = "documents";

export function documentsRoot(): string {
  return path.resolve(documentsDir);
}

// The most characters in one document chunk: the biggest chunk size the Act 2
// page offers, which the local reranker in Act 4 is proven to read whole.
export const documentChunkSize = Math.max(...chunkSizesToTry);

// Loads every Markdown document in `dir` as chunks. Throws on the first
// document with no visibility or no text, so a folder loads whole or not at
// all.
export function loadDocuments(dir: string): DocumentChunk[] {
  if (!existsSync(dir)) {
    throw new Error(
      `No documents folder at ${dir}. The workshop's documents are in ${documentsDir}/.`,
    );
  }
  return (
    readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      // Natural order, so prep-10.md follows prep-2.md.
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
      .flatMap((file) => loadDocument(path.join(dir, file)))
  );
}

// One document: its name from the file, its visibility from the frontmatter.
function loadDocument(file: string): DocumentChunk[] {
  const document = path.basename(file, ".md");
  const { fields, body } = splitFrontmatter(readFileSync(file, "utf8"));
  const visibility = fields.get("visibility") ?? "";
  if (visibility === "") {
    throw new Error(
      `${file} has no "visibility", so the loader can't tell who may see it. Start the file with frontmatter: a line of ---, then visibility: <value>, then ---.`,
    );
  }
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  if (paragraphs.length === 0) {
    throw new Error(`${file} has no text after its frontmatter.`);
  }
  return packParagraphs(paragraphs).map((text) => ({
    document,
    visibility,
    text,
  }));
}

// Frontmatter is the lines between a first line of `---` and the next `---`,
// each `key: value`. A file without it has no fields.
function splitFrontmatter(contents: string): {
  fields: Map<string, string>;
  body: string;
} {
  const lines = contents.replace(/^﻿/, "").split(/\r?\n/);
  const close = lines.indexOf("---", 1);
  if (lines[0] !== "---" || close === -1) {
    return { fields: new Map(), body: contents };
  }
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, close)) {
    const match = /^([\w-]+):(.*)$/.exec(line);
    if (match) fields.set(match[1], unquote(match[2].trim()));
  }
  return { fields, body: lines.slice(close + 1).join("\n") };
}

// `"barovia/dm"` and `'barovia/dm'` read as `barovia/dm`.
function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return (quoted ? quoted[2] : value).trim();
}

// Joins paragraphs into chunks of at most documentChunkSize characters. A
// paragraph that is over the size on its own stays whole in its own chunk.
function packParagraphs(paragraphs: string[]): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const joined = current === "" ? paragraph : `${current}\n\n${paragraph}`;
    if (current !== "" && joined.length > documentChunkSize) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = joined;
    }
  }
  chunks.push(current);
  return chunks;
}
