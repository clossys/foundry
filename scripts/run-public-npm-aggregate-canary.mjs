#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { AGGREGATE_CANARY_PATH, aggregateClosurePath, isAggregateClosurePath, runAggregatePublicNpmCanary } from "./lib/public-npm-aggregate-canary.mjs";

try {
  const args = process.argv.slice(2);
  const closureIndex = args.indexOf("--closure"), setIndex = args.indexOf("--set");
  const closurePath = closureIndex === -1 ? null : args[closureIndex + 1];
  const set = setIndex === -1 ? "oidc-successor" : args[setIndex + 1];
  if (args.length !== (closureIndex === -1 ? 0 : 2) + (setIndex === -1 ? 0 : 2) || (closureIndex !== -1 && (!closurePath || !isAggregateClosurePath(closurePath))) || !["baseline", "oidc-successor"].includes(set)) throw new Error("usage: run-public-npm-aggregate-canary.mjs [--set baseline|oidc-successor] [--closure governance/public-npm-aggregate-closures/<set>-<sha256>.json]");
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
    console.log(`public npm aggregate canary: SATISFIED — ${result.transcript.canonicalSha256}`);
  }
} catch (error) {
  console.error(`public npm aggregate canary: INDETERMINATE\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
