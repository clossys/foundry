#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { AGGREGATE_CANARY_PATH, AGGREGATE_TRANSCRIPT_DIRECTORY, aggregateClosurePath, aggregateTranscriptPath, isAggregateClosurePath, runAggregatePublicNpmCanary } from "./lib/public-npm-aggregate-canary.mjs";

try {
  const args = process.argv.slice(2);
  const closureIndex = args.indexOf("--closure"), setIndex = args.indexOf("--set"), outputIndex = args.indexOf("--output-dir");
  const closurePath = closureIndex === -1 ? null : args[closureIndex + 1];
  const set = setIndex === -1 ? "oidc-successor" : args[setIndex + 1];
  const outputDirectory = outputIndex === -1 ? AGGREGATE_TRANSCRIPT_DIRECTORY : args[outputIndex + 1];
  if (args.length !== (closureIndex === -1 ? 0 : 2) + (setIndex === -1 ? 0 : 2) + (outputIndex === -1 ? 0 : 2) || (closureIndex !== -1 && (!closurePath || !isAggregateClosurePath(closurePath))) || outputDirectory !== AGGREGATE_TRANSCRIPT_DIRECTORY || !["baseline", "oidc-successor"].includes(set)) throw new Error("usage: run-public-npm-aggregate-canary.mjs [--set baseline|oidc-successor] [--closure governance/public-npm-aggregate-closures/<set>-<sha256>.json] [--output-dir governance/public-npm-aggregate-transcripts]");
  const closure = closurePath ? JSON.parse(readFileSync(closurePath, "utf8")) : null;
  if (closure && closurePath !== aggregateClosurePath(set, closure.canonicalSha256)) throw new Error("closure path does not equal its set and canonical digest");
  const result = await runAggregatePublicNpmCanary({ root: process.cwd(), record: JSON.parse(readFileSync(AGGREGATE_CANARY_PATH, "utf8")), set, closure, closurePath, requirePinnedRuntime: true });
  if (result.verdict === "indeterminate") {
    console.error(`public npm aggregate canary: INDETERMINATE — ${result.reason}; ${result.pending.length} exact identity record(s) remain held or pending.`);
    process.exitCode = 2;
  } else if (result.verdict !== "satisfied") {
    console.error("public npm aggregate canary: VIOLATED");
    process.exitCode = 1;
  } else {
    await mkdir(outputDirectory, { recursive: true });
    if ((await lstat(outputDirectory)).isSymbolicLink()) throw new Error("aggregate transcript directory may not be a symlink");
    const outputPath = aggregateTranscriptPath(set, result.transcript.canonicalSha256);
    await writeFile(outputPath, `${JSON.stringify(result.transcript, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.log(`public npm aggregate canary: SATISFIED — ${result.transcript.canonicalSha256} — ${outputPath}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const violated = /generated aggregate transcript invalid|served bytes|identity|rollback|EEXIST|symlink/i.test(message);
  console.error(`public npm aggregate canary: ${violated ? "VIOLATED" : "INDETERMINATE"}\n${message}`);
  process.exitCode = violated ? 1 : 2;
}
