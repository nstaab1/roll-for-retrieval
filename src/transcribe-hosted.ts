// Act 1: add the hosted transcription call. The explainer page has the code:
// guide/act-1.html
import { writeFileSync } from "node:fs";
import path from "node:path";
import { models } from "./config.ts";
import { dollarsFor, elapsedSince } from "./cost-log.ts";
import { audioDuration, transcribe } from "./hosted.ts";
import { transcriptPaths, type HostedTranscript } from "./transcript.ts";

// Sends one audio file to gpt-transcribe through the shipped client and writes
// the text it returns beside the clip, with the call's wall time and dollars,
// for the comparison. The text has no timestamps, so it never feeds the vector
// store.
export async function transcribeHosted(
  audio: string,
): Promise<HostedTranscript> {
  // #region transcribeHosted
  const started = performance.now();
  // (1) The shipped client refuses a file over 25 MB, sends the rest to
  // gpt-transcribe and writes the cost log line.
  const text = await transcribe(audio);
  const wallSeconds = elapsedSince(started);
  // (2) ffprobe reads the clip's length. Hosted transcription is priced by it.
  const audioSeconds = audioDuration(audio);
  const result: HostedTranscript = {
    source: path.basename(audio),
    model: models.hostedTranscription,
    audioSeconds,
    wallSeconds,
    // (3) Priced from the table in src/config.ts, the same way the cost log is.
    dollars: dollarsFor(models.hostedTranscription, { audioSeconds }),
    // (4) Plain text. No timestamps, so nothing here can be cited.
    text,
  };
  // (5) Beside the clip, next to the local transcript, where compare looks.
  writeFileSync(
    transcriptPaths(audio).hosted,
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return result;
  // #endregion
}
