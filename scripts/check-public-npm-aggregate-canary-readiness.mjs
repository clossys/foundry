#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AGGREGATE_TRANSCRIPT_DIRECTORY, aggregateTranscriptPath, immutableRecordPaths } from "./lib/public-npm-aggregate-canary.mjs";

class ReadinessError extends Error { constructor(message, exitCode) { super(message); this.exitCode = exitCode; } }
function finish(message, exitCode) { console.error(`public npm aggregate canary: ${exitCode === 2 ? "INDETERMINATE" : "VIOLATED"} — ${message}`); process.exitCode = exitCode; }

try {
  const root = process.cwd();
  // Check each component with lstat; checking only the final directory follows
  // a hostile governance/ symlink before we get a chance to reject it.
  let component = root;
  for (const part of AGGREGATE_TRANSCRIPT_DIRECTORY.split("/")) {
    component = join(component, part);
    let state;
    try { state = lstatSync(component); }
    catch (error) {
      if (error?.code === "ENOENT") throw new ReadinessError("no immutable satisfied aggregate transcript exists", 2);
      throw error;
    }
    if (!state.isDirectory() || state.isSymbolicLink()) throw new Error("immutable transcript directory has a symlink or non-directory component");
  }
  const records = immutableRecordPaths({ root, directory: AGGREGATE_TRANSCRIPT_DIRECTORY });
  const actual = readdirSync(join(root, AGGREGATE_TRANSCRIPT_DIRECTORY), { withFileTypes: true });
  const actualPaths = actual.map((entry) => `${AGGREGATE_TRANSCRIPT_DIRECTORY}/${entry.name}`).sort();
  if (records.current.length === 0 && records.introduced.length === 0 && actual.length === 0) throw new ReadinessError("no immutable satisfied aggregate transcript exists", 2);
  if (records.current.length !== 2 || records.introduced.length !== 2 || actual.some((entry) => !entry.isFile() || entry.isSymbolicLink()) || JSON.stringify(actualPaths) !== JSON.stringify(records.current)) throw new ReadinessError("both exact frozen sets require exactly two tracked regular HEAD-introduced immutable transcripts", 1);
  const pairs = records.current.map((path) => ({ path, transcript: JSON.parse(execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8" })) }));
  if (!["baseline", "oidc-successor"].every((set) => pairs.filter(({ path, transcript }) => transcript?.set === set && aggregateTranscriptPath(transcript.set, transcript.canonicalSha256) === path).length === 1)) throw new ReadinessError("both exact frozen sets require one content-addressed satisfied transcript", 1);
  await import("./check-public-npm-aggregate-transcripts.mjs");
} catch (error) {
  const missing = error?.code === "ENOENT";
  finish(error instanceof Error ? error.message : String(error), error instanceof ReadinessError ? error.exitCode : missing ? 2 : 1);
}
