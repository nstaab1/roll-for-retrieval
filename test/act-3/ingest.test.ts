// Act 3: ingest, from the loaders to a saved index. It runs your cleaning and
// chunker from Act 2 and your embedding and indexing from Act 3 on a short
// stretch of one night and one DM document, for well under a cent. It needs a
// key, and fails on the starter with a stub's message.
import assert from "node:assert/strict";
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
import { describe, it, type TestContext } from "node:test";
import { CHUNK_OVERLAP, CHUNK_SIZE } from "../../src/choices.ts";
import { models } from "../../src/config.ts";
import { buildIndex } from "../../src/ingest.ts";
import { search } from "../../src/search.ts";
import {
  countChunks,
  openStore,
  saveStore,
  type IndexSettings,
} from "../../src/store.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const night = "barovia-2026-01-07";
const document = "barovia-strahd-plan";

// A transcripts folder with the first few minutes of one night, and a
// documents folder with one DM document.
function sources(t: TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), "ingest-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcripts = path.join(dir, "transcripts");
  const documents = path.join(dir, "documents");
  mkdirSync(transcripts);
  mkdirSync(documents);
  const whole = JSON.parse(
    readFileSync(path.join(repoRoot, "transcripts", `${night}.json`), "utf8"),
  ) as { transcription: unknown[] };
  writeFileSync(
    path.join(transcripts, `${night}.json`),
    JSON.stringify({
      ...whole,
      transcription: whole.transcription.slice(0, 60),
    }),
  );
  copyFileSync(
    path.join(repoRoot, "transcripts", `${night}.meta.json`),
    path.join(transcripts, `${night}.meta.json`),
  );
  copyFileSync(
    path.join(repoRoot, "documents", `${document}.md`),
    path.join(documents, `${document}.md`),
  );
  return { dir, transcripts, documents };
}

// A fixed setting, and yours once both are set.
const settingsToTry: IndexSettings[] = [
  { chunkSize: 300, chunkOverlap: 1, model: models.embedding },
];
if (CHUNK_SIZE !== null && CHUNK_OVERLAP !== null) {
  settingsToTry.unshift({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    model: models.embedding,
  });
}

for (const settings of settingsToTry) {
  describe(`buildIndex at chunk size ${settings.chunkSize}, overlap ${settings.chunkOverlap}`, () => {
    it("indexes the night and the document, and saves the values it was built at", async (t) => {
      const { dir, transcripts, documents } = sources(t);
      const printed: string[] = [];
      const store = await buildIndex(settings, {
        transcripts,
        documents,
        print: (line) => printed.push(line),
      });
      t.after(() => store.db.close());
      const file = path.join(dir, "index", "yours.tar.gz");
      await saveStore(store, file);

      const opened = await openStore(file);
      t.after(() => opened.db.close());
      assert.deepEqual(opened.settings, settings);
      assert.equal(await countChunks(opened), await countChunks(store));
      assert.ok(
        printed.some((line) => line === `barovia (1 night)`),
        `The loader prints the nights by campaign:\n${printed.join("\n")}`,
      );

      const { rows } = await opened.db.query<{
        night: string | null;
        document: string | null;
        visibility: string;
      }>("SELECT DISTINCT night, document, visibility FROM chunks");
      assert.deepEqual(
        rows.toSorted((a, b) => a.visibility.localeCompare(b.visibility)),
        [
          { night: null, document, visibility: "barovia/dm" },
          { night, document: null, visibility: "barovia/party" },
        ],
      );

      const [hit] = await search(
        opened,
        "What does Strahd plan to do with the town?",
        1,
      );
      assert.equal(hit.document, document);
    });
  });
}
