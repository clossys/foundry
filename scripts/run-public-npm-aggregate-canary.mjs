#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { AGGREGATE_CANARY_PATH, AGGREGATE_TRANSCRIPT_DIRECTORY, aggregateClosurePath, parseAggregateCanaryCli, retainAggregateTranscript, runAggregatePublicNpmCanary } from "./lib/public-npm-aggregate-canary.mjs";

class AggregateCanaryCliError extends Error {
  constructor(message, exitCode) { super(message); this.exitCode = exitCode; }
}

try {
  const { closurePath, set, outputDirectory } = parseAggregateCanaryCli(process.argv.slice(2));
  let closure;
  try { closure = closurePath ? JSON.parse(readFileSync(closurePath, "utf8")) : null; }
  catch (error) { throw new AggregateCanaryCliError(`immutable closure is unavailable: ${error instanceof Error ? error.message : String(error)}`, 2); }
  if (closure && closurePath !== aggregateClosurePath(set, closure.canonicalSha256)) throw new Error("closure path does not equal its set and canonical digest");
  const result = await runAggregatePublicNpmCanary({ root: process.cwd(), record: JSON.parse(readFileSync(AGGREGATE_CANARY_PATH, "utf8")), set, closure, closurePath, requirePinnedRuntime: true });
  if (result.verdict === "indeterminate") {
    console.error(`public npm aggregate canary: INDETERMINATE — ${result.reason}; ${result.pending.length} exact identity record(s) remain held or pending.`);
    process.exitCode = 2;
  } else if (result.verdict !== "satisfied") {
    console.error("public npm aggregate canary: VIOLATED");
    process.exitCode = 1;
  } else {
    const outputPath = await retainAggregateTranscript({ root: process.cwd(), transcript: result.transcript });
    console.log(`public npm aggregate canary: SATISFIED — ${result.transcript.canonicalSha256} — ${outputPath}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // Only an explicitly typed unavailable closure or the runner's structured
  // pending verdict is retryable. Unknown failures are integrity failures; do
  // not let attacker-controlled message text choose an exit class.
  const exitCode = error instanceof AggregateCanaryCliError ? error.exitCode : 1;
  console.error(`public npm aggregate canary: ${exitCode === 2 ? "INDETERMINATE" : "VIOLATED"}\n${message}`);
  process.exitCode = exitCode;
}
