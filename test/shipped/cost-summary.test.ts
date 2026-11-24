// `npm run cost`: the cost log summed by stage and model, with test runs left
// out and local seconds priced at the codespace's rate. These tests need no
// key and no network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSummary, summarize } from "../../scripts/cost.ts";
import type { CostLine } from "../../src/cost-log.ts";

const at = "2026-11-15T10:00:00.000Z";

const lines: CostLine[] = [
  {
    at,
    stage: "local-transcription",
    model: "base.en",
    audioSeconds: 600,
    dollars: 0,
    seconds: 3600,
  },
  {
    at,
    stage: "chat",
    model: "openai/gpt-4o-mini",
    inputTokens: 1000,
    outputTokens: 100,
    dollars: 0.00021,
    seconds: 1.2,
  },
  {
    at,
    stage: "chat",
    model: "openai/gpt-4o-mini",
    inputTokens: 2000,
    outputTokens: 50,
    dollars: 0.00033,
    seconds: 0.8,
  },
  {
    at,
    stage: "chat",
    model: "openai/gpt-4o-mini",
    inputTokens: 500,
    outputTokens: 20,
    dollars: 0.0001,
    seconds: 0.5,
    test: true,
  },
];

describe("the cost summary", () => {
  it("adds up each stage and model, in the order the pipeline runs, and leaves test calls out", () => {
    const rows = summarize(lines);
    assert.deepEqual(
      rows.map((r) => [r.stage, r.model, r.calls]),
      [
        ["local-transcription", "base.en", 1],
        ["chat", "openai/gpt-4o-mini", 2],
      ],
    );
    assert.equal(rows[1].inputTokens, 3000);
    assert.equal(rows[1].outputTokens, 150);
    assert.ok(Math.abs(rows[1].dollars - 0.00054) < 1e-12);
    assert.equal(rows[0].local, true);
    assert.equal(rows[1].local, false);
  });

  it("prices an hour of local transcription at the codespace's hourly rate", () => {
    const text = formatSummary(lines).join("\n");
    assert.match(
      text,
      /^3 calls in the cost log, leaving out 1 from test runs\./,
    );
    assert.match(text, /Local at \$0\.36\/h/);
    assert.match(
      text,
      /local-transcription\s+base\.en\s+1\s+600 s of audio\s+\$0\.000\s+3600\.0 s\s+\$0\.360/,
    );
    assert.match(
      text,
      /The local stages ran 3600\.0 s, which is \$0\.360 of codespace time at \$0\.36 an hour\./,
    );
  });

  it("shows a hosted cost too small for a tenth of a cent", () => {
    assert.match(
      formatSummary(lines).join("\n"),
      /chat\s+openai\/gpt-4o-mini\s+2\s+3,000 in, 150 out tokens\s+\$0\.00054/,
    );
  });

  it("says so when there's nothing but test runs", () => {
    assert.deepEqual(formatSummary([lines[3]]), [
      "No calls in the cost log yet, leaving out 1 from test runs. Every command that calls a model adds to it.",
    ]);
  });
});
