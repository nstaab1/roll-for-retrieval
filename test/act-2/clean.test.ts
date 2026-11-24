// Act 2: cleaning. These tests need no key and no network. They fail on the
// starter with the stub's message.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { clean, type SegmentRecord } from "../../src/clean.ts";
import type { Night } from "../../src/nights.ts";
import { readMeta, readSegments, type Segment } from "../../src/transcript.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");

// A segment as whisper.cpp writes it, with its leading space.
function segment(from: number, to: number, text: string): Segment {
  const stamp = (ms: number) =>
    new Date(ms).toISOString().slice(11, 23).replace(".", ",");
  return {
    timestamps: { from: stamp(from), to: stamp(to) },
    offsets: { from, to },
    text: ` ${text}`,
  };
}

// A night as the night loader returns it, with a made-up meta file.
function night(id: string, campaign: string, segments: Segment[]): Night {
  return {
    id,
    campaign,
    meta: {
      campaign,
      source: `${id}.mp3`,
      model: "large-v3-turbo",
      audioSeconds: 60,
      wallSeconds: 5,
      segments: segments.length,
      transcribedAt: "2026-10-11T15:39:00.000Z",
    },
    segments,
  };
}

// A prepared transcript and its campaign, read straight from transcripts/.
function prepared(id: string): Night {
  const file = path.join(repoRoot, "transcripts", `${id}.json`);
  const meta = readMeta(path.join(repoRoot, "transcripts", `${id}.meta.json`));
  return { id, campaign: meta.campaign, meta, segments: readSegments(file) };
}

describe("cleaning", () => {
  it("turns each segment into a record of night, start, end, campaign, visibility and text", () => {
    const records = clean(
      night("barovia-2025-12-29", "barovia", [
        segment(2820, 6200, "Freya and Cody are outside."),
        segment(6200, 9100, "The windmill is burning."),
      ]),
    );

    assert.deepEqual(records, [
      {
        night: "barovia-2025-12-29",
        start: 2820,
        end: 6200,
        campaign: "barovia",
        visibility: "barovia/party",
        text: "Freya and Cody are outside.",
      },
      {
        night: "barovia-2025-12-29",
        start: 6200,
        end: 9100,
        campaign: "barovia",
        visibility: "barovia/party",
        text: "The windmill is burning.",
      },
    ] satisfies SegmentRecord[]);
  });

  it("gives a night its campaign's party visibility, whatever the campaign is called", () => {
    const records = clean(
      night("tuesday-1", "my-table", [segment(0, 1000, "Roll initiative.")]),
    );

    assert.equal(records[0].visibility, "my-table/party");
  });

  it("collapses a run of identical consecutive segments to the first of them", () => {
    const records = clean(
      night("toe-wittine-session-1", "toe-wittine", [
        segment(0, 1000, "Roll it."),
        segment(1000, 2000, "Yeah."),
        segment(2000, 3000, "Yeah."),
        segment(3000, 4000, "Yeah."),
        segment(4000, 5000, "Nat 20."),
        segment(5000, 6000, "Yeah."),
      ]),
    );

    assert.deepEqual(
      records.map((r) => [r.start, r.end, r.text]),
      [
        [0, 1000, "Roll it."],
        [1000, 2000, "Yeah."],
        [4000, 5000, "Nat 20."],
        [5000, 6000, "Yeah."],
      ],
      "Only a run of the same text in a row collapses. The same text later on stays.",
    );
  });

  it("leaves no repetition loop in toe-wittine-session-1, where Whisper repeats one segment hundreds of times", () => {
    const night1 = prepared("toe-wittine-session-1");

    const records = clean(night1);

    assert.ok(records.length > 0, "toe-wittine-session-1 cleaned to nothing.");
    assert.ok(
      records.length < night1.segments.length,
      "toe-wittine-session-1 has repetition loops, so it should clean to fewer records than segments.",
    );
    for (let i = 1; i < records.length; i++) {
      assert.notEqual(
        records[i].text,
        records[i - 1].text,
        `Records ${i} and ${i + 1} are the same segment twice: "${records[i].text}"`,
      );
    }
  });
});
