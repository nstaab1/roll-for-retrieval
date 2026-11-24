// The document loader reads a folder of written sources fail-closed: every
// document names its visibility in frontmatter. These tests need no key and no
// network.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import {
  documentChunkSize,
  documentsRoot,
  loadDocuments,
} from "../../src/documents.ts";

function scratch(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "documents-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir: string, file: string, contents: string): void {
  writeFileSync(path.join(dir, file), contents);
}

function withVisibility(visibility: string, body: string): string {
  return `---\nvisibility: ${visibility}\n---\n\n${body}\n`;
}

// A paragraph of about `length` characters.
function paragraph(word: string, length: number): string {
  return Array.from(
    { length: Math.ceil(length / (word.length + 1)) },
    () => word,
  ).join(" ");
}

describe("loadDocuments", () => {
  it("makes one chunk of a short document, carrying its visibility", (t) => {
    const dir = scratch(t);
    write(
      dir,
      "briar-secret.md",
      withVisibility(
        "toe-wittine/dm",
        "# Elder Briar's secret\n\nHe knows more than he says.",
      ),
    );

    assert.deepEqual(loadDocuments(dir), [
      {
        document: "briar-secret",
        visibility: "toe-wittine/dm",
        text: "# Elder Briar's secret\n\nHe knows more than he says.",
      },
    ]);
  });

  it("splits a long document on paragraphs, each chunk keeping the visibility", (t) => {
    const dir = scratch(t);
    const paragraphs = [
      "# Prep notes",
      paragraph("alpha", 500),
      paragraph("bravo", 500),
      paragraph("charlie", 500),
      paragraph("delta", 500),
    ];
    write(
      dir,
      "prep.md",
      withVisibility("barovia/dm", paragraphs.join("\n\n")),
    );

    const chunks = loadDocuments(dir);

    assert.ok(chunks.length > 1, `${chunks.length} chunks`);
    for (const chunk of chunks) {
      assert.equal(chunk.document, "prep");
      assert.equal(chunk.visibility, "barovia/dm");
      assert.ok(chunk.text.length <= documentChunkSize, chunk.text);
    }
    assert.equal(
      chunks.map((chunk) => chunk.text).join("\n\n"),
      paragraphs.join("\n\n"),
    );
  });

  it("keeps a paragraph whole even when it alone is over the size", (t) => {
    const dir = scratch(t);
    const long = paragraph("echo", documentChunkSize + 200);
    write(dir, "long.md", withVisibility("barovia/dm", `Intro.\n\n${long}`));

    assert.deepEqual(
      loadDocuments(dir).map((chunk) => chunk.text),
      ["Intro.", long],
    );
  });

  it("refuses a document with no frontmatter, naming the file and the fix", (t) => {
    const dir = scratch(t);
    write(dir, "ok.md", withVisibility("barovia/party", "Fine."));
    write(dir, "loose.md", "# A handout\n\nNo frontmatter here.\n");

    assert.throws(
      () => loadDocuments(dir),
      (error: Error) => {
        assert.match(error.message, /loose\.md/);
        assert.match(error.message, /no "visibility"/);
        assert.match(error.message, /visibility: <value>/);
        return true;
      },
    );
  });

  it("refuses frontmatter with no visibility, even in a folder named after one", (t) => {
    const dir = path.join(scratch(t), "dm");
    mkdirSync(dir);
    write(dir, "secret.md", "---\ntitle: A secret\n---\n\nShh.\n");

    assert.throws(() => loadDocuments(dir), /secret\.md has no "visibility"/);
  });

  it("refuses a visibility that is empty", (t) => {
    for (const value of ["", '""', "  "]) {
      const dir = scratch(t);
      write(dir, "empty.md", withVisibility(value, "Text."));

      assert.throws(() => loadDocuments(dir), /no "visibility"/, value);
    }
  });

  it("refuses frontmatter that never closes", (t) => {
    const dir = scratch(t);
    write(dir, "open.md", "---\nvisibility: barovia/dm\n\nText.\n");

    assert.throws(() => loadDocuments(dir), /open\.md has no "visibility"/);
  });

  it("reads a quoted visibility and other frontmatter fields", (t) => {
    const dir = scratch(t);
    write(
      dir,
      "quoted.md",
      '---\ntitle: Rules\nvisibility: "toe-wittine/party"\n---\n\nText.\n',
    );

    assert.equal(loadDocuments(dir)[0].visibility, "toe-wittine/party");
  });

  it("refuses a document with no text", (t) => {
    const dir = scratch(t);
    write(dir, "blank.md", withVisibility("barovia/dm", ""));

    assert.throws(() => loadDocuments(dir), /blank\.md has no text/);
  });

  it("reads only Markdown files, in name order", (t) => {
    const dir = scratch(t);
    write(dir, "b.md", withVisibility("barovia/party", "Bee."));
    write(dir, "a.md", withVisibility("barovia/party", "Ay."));
    write(dir, "notes.txt", "Not a document.");

    assert.deepEqual(
      loadDocuments(dir).map((chunk) => chunk.document),
      ["a", "b"],
    );
  });

  it("refuses a folder that doesn't exist", (t) => {
    const dir = path.join(scratch(t), "missing");

    assert.throws(() => loadDocuments(dir), /No documents folder at .*missing/);
  });
});

describe("the shipped documents", () => {
  const chunks = loadDocuments(documentsRoot());
  const visibilityOf = new Map(
    chunks.map((chunk) => [chunk.document, chunk.visibility]),
  );

  it("are four DM documents and one Toe Wittine party document", () => {
    const visibilities = [...visibilityOf.values()];

    assert.equal(visibilityOf.size, 5);
    assert.equal(
      visibilities.filter((visibility) => visibility.endsWith("/dm")).length,
      4,
    );
    assert.ok(visibilities.includes("toe-wittine/dm"));
    assert.deepEqual(
      visibilities.filter((visibility) => visibility.endsWith("/party")),
      ["toe-wittine/party"],
    );
  });
});
