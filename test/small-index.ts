// A small index for the tests that ask through the whole pipeline: the start
// of two real nights and two documents, built with your code from Acts 2 and
// 3. Building it embeds every chunk, for well under a cent, and needs a key.
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, type TestContext } from "node:test";
import { models } from "../src/config.ts";
import { buildIndex } from "../src/ingest.ts";
import type { Store } from "../src/store.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const nights = ["barovia-2025-12-01", "toe-wittine-session-3"];
const documents = ["barovia-strahd-plan", "toe-wittine-briar-secret"];

// A folder holding the first minutes of each night, and the documents.
function sources(dir: string) {
  const transcripts = path.join(dir, "transcripts");
  const docs = path.join(dir, "documents");
  mkdirSync(transcripts);
  mkdirSync(docs);
  for (const night of nights) {
    const from = path.join(repoRoot, "transcripts", night);
    const whole = JSON.parse(readFileSync(`${from}.json`, "utf8")) as {
      transcription: unknown[];
    };
    writeFileSync(
      path.join(transcripts, `${night}.json`),
      JSON.stringify({
        ...whole,
        transcription: whole.transcription.slice(0, 60),
      }),
    );
    copyFileSync(
      `${from}.meta.json`,
      path.join(transcripts, `${night}.meta.json`),
    );
  }
  for (const document of documents) {
    copyFileSync(
      path.join(repoRoot, "documents", `${document}.md`),
      path.join(docs, `${document}.md`),
    );
  }
  return { transcripts, documents: docs };
}

// One small index for every test in the file that calls this, built the
// first time a test asks for it, so a stub it runs into fails that test with
// the stub's message. `costLog` points the cost log at a file of the test's
// own, so it can count the calls one ask made.
export function smallIndex() {
  let dir: string | undefined;
  let built: Promise<Store> | undefined;
  const folder = () => (dir ??= mkdtempSync(path.join(tmpdir(), "ask-")));
  after(async () => {
    await built?.then((store) => store.db.close()).catch(() => {});
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  return {
    store(): Promise<Store> {
      built ??= buildIndex(
        { chunkSize: 300, chunkOverlap: 1, model: models.embedding },
        { ...sources(folder()), print: () => {} },
      );
      return built;
    },
    costLog(t: TestContext): string {
      const saved = process.env.COST_LOG;
      const file = path.join(folder(), `cost-log-${Math.random()}.jsonl`);
      process.env.COST_LOG = file;
      t.after(() => {
        if (saved === undefined) delete process.env.COST_LOG;
        else process.env.COST_LOG = saved;
      });
      return file;
    },
  };
}
