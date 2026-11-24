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
// for the comparison. The text has no timestamps, so it never feeds the store.
export async function transcribeHosted(
  audio: string,
): Promise<HostedTranscript> {
  throw new Error("Not added yet. Open guide/act-1.html, step 1.");
}
