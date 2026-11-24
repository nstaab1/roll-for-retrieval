// The night loader reads a folder of transcripts fail-closed: every night needs
// a meta file naming its campaign. These tests need no key and no network.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { formatNights, loadNights, transcriptsRoot } from "../../src/nights.ts";
import type { Meta, Segment, WhisperOutput } from "../../src/transcript.ts";

function scratch(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "nights-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const segment: Segment = {
  timestamps: { from: "00:00:02,820", to: "00:00:06,200" },
  offsets: { from: 2820, to: 6200 },
  text: " Freya and Cody are outside.",
};

function meta(campaign: string): Meta {
  return {
    campaign,
    source: "recording.mp3",
    model: "large-v3-turbo",
    audioSeconds: 60,
    wallSeconds: 5,
    segments: 1,
    transcribedAt: "2026-10-11T15:39:00.000Z",
  };
}

// Writes a night's whisper.cpp JSON and its meta file, or no meta file for null.
function night(
  dir: string,
  id: string,
  metaFile: object | null = meta("barovia"),
): void {
  const output: WhisperOutput = { transcription: [segment] };
  writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(output));
  if (metaFile) {
    writeFileSync(path.join(dir, `${id}.meta.json`), JSON.stringify(metaFile));
  }
}

function load(dir: string) {
  const printed: string[] = [];
  const nights = loadNights(dir, (line) => printed.push(line));
  return { nights, printed: printed.join("\n") };
}

describe("loadNights", () => {
  it("loads a night with its id, campaign, meta and segments", (t) => {
    const dir = scratch(t);
    night(dir, "barovia-2025-12-29");

    const { nights } = load(dir);

    assert.equal(nights.length, 1);
    assert.equal(nights[0].id, "barovia-2025-12-29");
    assert.equal(nights[0].campaign, "barovia");
    assert.equal(nights[0].meta.model, "large-v3-turbo");
    assert.deepEqual(nights[0].segments, [segment]);
  });

  it("refuses a night with no meta file, naming the file and the fix", (t) => {
    const dir = scratch(t);
    night(dir, "barovia-2025-12-29");
    night(dir, "barovia-2026-01-07", null);

    assert.throws(
      () => load(dir),
      (error: Error) => {
        assert.match(error.message, /barovia-2026-01-07\.json/);
        assert.match(error.message, /no meta file/);
        assert.match(error.message, /barovia-2026-01-07\.meta\.json/);
        assert.match(error.message, /--campaign/);
        return true;
      },
    );
  });

  it("refuses a meta file with no campaign, even in a folder named after one", (t) => {
    const dir = path.join(scratch(t), "barovia");
    mkdirSync(dir);
    const { campaign, ...noCampaign } = meta("barovia");
    night(dir, "barovia-2025-12-29", noCampaign);

    assert.throws(
      () => load(dir),
      (error: Error) => {
        assert.match(error.message, /barovia-2025-12-29\.meta\.json/);
        assert.match(error.message, /no "campaign"/);
        return true;
      },
    );
  });

  it("refuses a campaign that is empty or not a string", (t) => {
    for (const campaign of ["", "  ", 7, null]) {
      const dir = scratch(t);
      night(dir, "barovia-2025-12-29", { ...meta("barovia"), campaign });

      assert.throws(() => load(dir), /no "campaign"/, String(campaign));
    }
  });

  it("refuses a night file that isn't whisper.cpp's JSON", (t) => {
    const dir = scratch(t);
    writeFileSync(path.join(dir, "notes.json"), JSON.stringify({ text: "" }));
    writeFileSync(
      path.join(dir, "notes.meta.json"),
      JSON.stringify(meta("barovia")),
    );

    assert.throws(() => load(dir), /notes\.json.*no "transcription"/);
  });

  it("refuses a folder that doesn't exist", (t) => {
    const dir = path.join(scratch(t), "missing");

    assert.throws(() => load(dir), /No transcripts folder at .*missing/);
  });

  it("skips hosted transcripts, which never feed the vector store", (t) => {
    const dir = scratch(t);
    night(dir, "barovia-2025-12-29");
    writeFileSync(
      path.join(dir, "barovia-2025-12-29.hosted.json"),
      JSON.stringify({ text: "no timestamps" }),
    );

    const { nights } = load(dir);

    assert.deepEqual(
      nights.map((n) => n.id),
      ["barovia-2025-12-29"],
    );
  });

  it("prints the nights it found, grouped by campaign", (t) => {
    const dir = scratch(t);
    night(dir, "toe-wittine-session-10", meta("toe-wittine"));
    night(dir, "barovia-2025-12-29");
    night(dir, "toe-wittine-session-3", meta("toe-wittine"));
    night(dir, "barovia-2025-12-01");

    const { printed } = load(dir);

    assert.equal(
      printed,
      [
        `Loaded 4 nights from ${dir}:`,
        "barovia (2 nights)",
        "  barovia-2025-12-01",
        "  barovia-2025-12-29",
        "toe-wittine (2 nights)",
        "  toe-wittine-session-3",
        "  toe-wittine-session-10",
      ].join("\n"),
    );
  });

  it("says so when the folder holds no nights", (t) => {
    const dir = scratch(t);

    const { nights, printed } = load(dir);

    assert.deepEqual(nights, []);
    assert.equal(printed, `No nights in ${dir}.`);
  });
});

describe("formatNights", () => {
  it("says night, not nights, for a campaign of one", () => {
    const lines = formatNights("transcripts", [
      { id: "toe-wittine-session-1", campaign: "toe-wittine" },
    ]);

    assert.deepEqual(lines, [
      "Loaded 1 night from transcripts:",
      "toe-wittine (1 night)",
      "  toe-wittine-session-1",
    ]);
  });
});

describe("the prepared transcripts", () => {
  it("load as seven nights, four Barovia and three Toe Wittine", () => {
    const nights = loadNights(transcriptsRoot(), () => {});

    assert.deepEqual(
      nights.map((n) => `${n.campaign} ${n.id}`),
      [
        "barovia barovia-2025-12-01",
        "barovia barovia-2025-12-23",
        "barovia barovia-2025-12-29",
        "barovia barovia-2026-01-07",
        "toe-wittine toe-wittine-session-1",
        "toe-wittine toe-wittine-session-3",
        "toe-wittine toe-wittine-session-4.1",
      ],
    );
    for (const n of nights) {
      assert.equal(n.meta.model, "large-v3-turbo", n.id);
      assert.equal(n.segments.length, n.meta.segments, n.id);
    }
  });
});
