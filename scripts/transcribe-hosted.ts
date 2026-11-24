// `npm run transcribe:hosted -- <audio>` runs the hosted transcription call
// you add in Act 1 and says what it wrote.
import { existsSync } from "node:fs";
import {
  formatDollars,
  formatDuration,
  transcriptPaths,
} from "../src/transcript.ts";
import { transcribeHosted } from "../src/transcribe-hosted.ts";

if (import.meta.main) {
  const audio = process.argv[2];
  try {
    if (!audio) {
      throw new Error(
        "Name the clip to transcribe. Usage: npm run transcribe:hosted -- <audio file>",
      );
    }
    if (!existsSync(audio)) {
      throw new Error(
        `No audio file at ${audio}. The sample clips are in audio/; run npm run fetch-clips if that folder is empty.`,
      );
    }
    const { wallSeconds, dollars } = await transcribeHosted(audio);
    console.log(
      `Wrote ${transcriptPaths(audio).hosted} in ${formatDuration(wallSeconds)} for ${formatDollars(dollars)}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
