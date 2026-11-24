import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { choiceGuard } from "../require-choice.ts";

describe("a choice guard", () => {
  const requireChoice = choiceGuard({
    CHUNK_SIZE: null as number | null,
    TOP_K: 8 as number | null,
  });

  it("fails an unset choice, naming it, its file and the guide page and step", () => {
    assert.throws(() => requireChoice("CHUNK_SIZE", "act-2", 3), {
      name: "AssertionError",
      message:
        "Pick CHUNK_SIZE in src/choices.ts. Open guide/act-2.html, step 3.",
    });
  });

  it("returns a choice the attendee has set", () => {
    assert.equal(requireChoice("TOP_K", "act-3", 4), 8);
  });
});
