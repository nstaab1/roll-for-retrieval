// A store whose vectors are placed by hand around one question's, so the same
// chunks come back nearest on every run: six from the DM's plan, then the
// player's. It shows what each place for the access filter leaves a player.
// Building it embeds the question once, for well under a cent, and needs a
// key.
import { after } from "node:test";
import { models } from "../src/config.ts";
import { embed } from "../src/hosted.ts";
import {
  createStore,
  indexChunks,
  type ChunkRow,
  type EmbeddedChunk,
  type Store,
} from "../src/store.ts";

// The question every chunk is placed around, and the DM secret its answer
// must never hold for a player.
export const question =
  "What does Strahd plan for the party after the festival?";
export const secret = "dinner at the castle";

// How many chunks search returns, and how many of the nearest are the DM's.
// Filtered after search, a player keeps the difference.
export const k = 8;
export const dmNearest = 6;

const dm = (text: string): ChunkRow => ({
  night: null,
  start_ms: null,
  end_ms: null,
  document: "barovia-strahd-plan",
  campaign: null,
  visibility: "barovia/dm",
  text,
});

const party = (minute: number, text: string): ChunkRow => ({
  night: "barovia-2026-01-07",
  start_ms: minute * 60_000,
  end_ms: minute * 60_000 + 20_000,
  document: null,
  campaign: "barovia",
  visibility: "barovia/party",
  text,
});

// Each chunk and how near the question it sits, as cosine distance, nearest
// first. Six DM chunks fill the top eight, and ten party chunks follow.
const placed: Array<[ChunkRow, number]> = [
  [
    dm(`A second letter in the carriage invites the whole party to ${secret}.`),
    0.1,
  ],
  [dm("Strahd means the letter for the party, not the town."), 0.12],
  [
    party(80, "So what do we think Strahd does now that the Baron is dead?"),
    0.13,
  ],
  [dm("He waits three days before he makes his move."), 0.14],
  [dm("On the fourth night a black carriage stops outside the church."), 0.16],
  [party(81, "The festival is over and nobody runs the town."), 0.17],
  [dm("He'll offer them the town to rule if they'll hold it for him."), 0.18],
  [dm("If they burn the first letter, the cultists strike the church."), 0.2],
  [party(82, "We should check on Father Lucian at the church."), 0.3],
  [party(83, "The guards dropped their weapons in the square."), 0.32],
  [party(84, "Ireena should stay with us until we leave town."), 0.34],
  [party(85, "Let's go back to the Blue Water Inn and rest."), 0.36],
  [party(86, "The wicker sun went up like a bomb."), 0.38],
  [party(87, "Lady Wachter's guards are arguing in the yard."), 0.4],
  [party(88, "I want to find out who packed the powder."), 0.42],
  [party(89, "Somebody has to bury the dead."), 0.44],
];

// A unit vector at `distance` from `toward`, turned off it along the
// `axis`-th dimension, so every chunk points its own way.
function placeAt(toward: number[], distance: number, axis: number): number[] {
  const similarity = 1 - distance;
  // That dimension with `toward`'s own direction taken out of it.
  const side = toward.map((x, i) => (i === axis ? 1 : 0) - toward[axis] * x);
  const length = Math.hypot(...side);
  const sideways = Math.sqrt(1 - similarity ** 2);
  return toward.map((x, i) => similarity * x + (sideways * side[i]) / length);
}

// The store, built the first time a test asks for it, so a stub it runs into
// fails that test with the stub's message.
export function placedIndex() {
  let built: Promise<Store> | undefined;
  after(async () => {
    await built?.then((store) => store.db.close()).catch(() => {});
  });
  return {
    store(): Promise<Store> {
      built ??= (async () => {
        const [vector] = await embed([question], { model: models.embedding });
        const length = Math.hypot(...vector);
        const toward = vector.map((x) => x / length);
        const chunks: EmbeddedChunk[] = placed.map(([row, distance], i) => ({
          ...row,
          embedding: placeAt(toward, distance, i),
        }));
        const store = await createStore({
          chunkSize: 300,
          chunkOverlap: 1,
          model: models.embedding,
        });
        await indexChunks(store, chunks);
        return store;
      })();
      return built;
    },
  };
}
