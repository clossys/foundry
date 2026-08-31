#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { AGGREGATE_TRANSCRIPT_DIRECTORY, aggregateTranscriptPath } from "./lib/public-npm-aggregate-canary.mjs";

if (!existsSync(AGGREGATE_TRANSCRIPT_DIRECTORY)) {
  console.error("public npm aggregate canary: INDETERMINATE — no immutable satisfied aggregate transcript exists.");
  process.exitCode = 2;
} else {
  const records = [];
  try {
    for (const file of readdirSync(AGGREGATE_TRANSCRIPT_DIRECTORY)) {
      const path = `${AGGREGATE_TRANSCRIPT_DIRECTORY}/${file}`;
      const transcript = JSON.parse(readFileSync(path, "utf8"));
      if (path === aggregateTranscriptPath(transcript.set, transcript.canonicalSha256)) records.push(transcript);
    }
  } catch {
    console.error("public npm aggregate canary: INDETERMINATE — immutable transcript directory is unreadable or malformed.");
    process.exitCode = 2;
  }
  if (!process.exitCode && !["baseline", "oidc-successor"].every((set) => records.filter((record) => record.set === set).length === 1)) {
    console.error("public npm aggregate canary: INDETERMINATE — both exact frozen sets require one content-addressed satisfied transcript.");
    process.exitCode = 2;
  } else if (!process.exitCode) await import("./check-public-npm-aggregate-transcripts.mjs");
}
