// The swap `npm run eval -- --swap <name>` tries: one stage's model replaced
// by a pricier or newer one for that run only. Your choices stay as they are,
// and every other command runs the workshop's models.
import { models, swaps } from "./config.ts";

// A swap's name, as the attendee types it after --swap.
export type SwapName = keyof typeof swaps;

// The stages a swap can replace, named as src/config.ts names their models.
export type SwappedStage = (typeof swaps)[SwapName]["replaces"];

// Every swap, in the order src/config.ts lists them.
export const swapNames = Object.keys(swaps) as SwapName[];

// The swap this process runs with, if any.
let current: SwapName | undefined;

// Checks a swap's name, as the attendee typed it.
export function parseSwap(name: string): SwapName {
  if (!(swapNames as string[]).includes(name)) {
    throw new Error(
      `There's no swap called "${name}". Try ${swapNames.join(", ")}.`,
    );
  }
  return name as SwapName;
}

// Runs the rest of this process with `name`'s model in place of the one it
// replaces, or with the workshop's models again when `name` is undefined.
export function useSwap(name: SwapName | undefined): void {
  current = name;
}

// The model a stage runs: the swap's, when the current swap replaces that
// stage, and the workshop's otherwise.
export function modelFor(stage: SwappedStage): string {
  if (current !== undefined && swaps[current].replaces === stage) {
    return swaps[current].model;
  }
  return models[stage];
}
