#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  AGGREGATE_V2_CANARY_PATH,
  aggregateV2ErrorExitCode,
  aggregateV2ClosurePath,
  parseAggregateV2Cli,
  retainAggregateV2Transcript,
  runAggregatePublicNpmCanaryV2,
} from "./lib/public-npm-aggregate-canary-v2.mjs";

class AggregateV2CliError extends Error {
  constructor(message, exitCode) { super(message); this.exitCode = exitCode; }
}

try {
  const { closurePath } = parseAggregateV2Cli(process.argv.slice(2));
  const root = process.cwd();
  let closure = null;
  if (closurePath !== null) {
    if (!execFileSync("git", ["ls-tree", "HEAD", "--", closurePath], { cwd: root, encoding: "utf8" }).startsWith("100644 ")) throw new AggregateV2CliError("v2 closure must be an available regular committed blob", 2);
    closure = JSON.parse(execFileSync("git", ["show", `HEAD:${closurePath}`], { cwd: root, encoding: "utf8" }));
    if (closurePath !== aggregateV2ClosurePath(closure.canonicalSha256)) throw new Error("v2 closure path does not equal its digest identity");
  }
  const readHead = (path) => execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const result = await runAggregatePublicNpmCanaryV2({ root, plan: JSON.parse(readHead(AGGREGATE_V2_CANARY_PATH)), closure, closurePath, read: readHead, requirePinnedRuntime: true });
  if (result.verdict === "indeterminate") { console.error(`public npm aggregate canary v2: INDETERMINATE — ${result.reason}`); process.exitCode = 2; }
  else if (result.verdict !== "satisfied") { console.error("public npm aggregate canary v2: VIOLATED"); process.exitCode = 1; }
  else console.log(`public npm aggregate canary v2: SATISFIED — ${result.transcript.canonicalSha256} — ${await retainAggregateV2Transcript({ root, transcript: result.transcript })}`);
} catch (error) {
  const exitCode = error instanceof AggregateV2CliError ? error.exitCode : aggregateV2ErrorExitCode(error);
  console.error(`public npm aggregate canary v2: ${exitCode === 2 ? "INDETERMINATE" : "VIOLATED"}\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = exitCode;
}
