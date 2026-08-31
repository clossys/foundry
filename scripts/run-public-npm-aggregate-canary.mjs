#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { AGGREGATE_CANARY_PATH, runAggregatePublicNpmCanary } from "./lib/public-npm-aggregate-canary.mjs";

try {
  const index = process.argv.indexOf("--closure");
  const closurePath = index === -1 ? null : process.argv[index + 1];
  if (index !== -1 && (!closurePath || process.argv.length !== index + 3)) throw new Error("usage: run-public-npm-aggregate-canary.mjs [--closure governance/public-npm-aggregate-closures/<set>-<sha256>.json]");
  const closure = closurePath ? JSON.parse(readFileSync(closurePath, "utf8")) : null;
  const result = await runAggregatePublicNpmCanary({ root: process.cwd(), record: JSON.parse(readFileSync(AGGREGATE_CANARY_PATH, "utf8")), closure, closurePath, requirePinnedRuntime: true });
  if (result.verdict === "indeterminate") {
    console.error(`public npm aggregate canary: INDETERMINATE — ${result.reason}; ${result.pending.length} exact identity record(s) remain held or pending.`);
    process.exitCode = 2;
  } else if (result.verdict !== "satisfied") {
    console.error("public npm aggregate canary: VIOLATED");
    process.exitCode = 1;
  } else {
    console.log(`public npm aggregate canary: SATISFIED — ${result.transcript.canonicalSha256}`);
  }
} catch (error) {
  console.error(`public npm aggregate canary: INDETERMINATE\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
