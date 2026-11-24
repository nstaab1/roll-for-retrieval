// Guards a test on a value from src/choices.ts. An unset choice fails the test
// with a message naming the choice, and the explainer page and step that help
// pick it, worded like a stub's message.
import assert from "node:assert/strict";
import * as choices from "../src/choices.ts";

export function choiceGuard<C extends object>(from: C) {
  return <K extends keyof C & string>(
    name: K,
    page: string,
    step: number,
  ): NonNullable<C[K]> => {
    const value = from[name];
    assert.ok(
      value !== null && value !== undefined,
      `Pick ${name} in src/choices.ts. Open guide/${page}.html, step ${step}.`,
    );
    return value;
  };
}

export const requireChoice = choiceGuard(choices);
