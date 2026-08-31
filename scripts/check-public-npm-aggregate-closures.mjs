#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AGGREGATE_CANARY_PATH, AGGREGATE_CLOSURE_DIRECTORY, resolveAggregateClosure, validateSatisfiedTranscriptHistory } from "./lib/public-npm-aggregate-canary.mjs";

const root = process.cwd();
const plan = JSON.parse(readFileSync(join(root, AGGREGATE_CANARY_PATH), "utf8"));
const files = existsSync(join(root, AGGREGATE_CLOSURE_DIRECTORY)) ? execFileSync("git", ["ls-files", "--", AGGREGATE_CLOSURE_DIRECTORY], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean) : [];
const findings = [];
for (const path of files) {
  try {
    const closure = JSON.parse(readFileSync(join(root, path), "utf8"));
    resolveAggregateClosure(plan, closure.set, closure);
    const commits = execFileSync("git", ["log", "--format=%H", "--name-status", "--follow", "--", path], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    const history = []; let commit = null;
    for (const line of commits) {
      if (/^[a-f0-9]{40}$/.test(line)) { commit = line; continue; }
      const [status, changed] = line.split("\t");
      if (commit && changed === path) history.push({ commit, status, sha256: closure.canonicalSha256 });
    }
    findings.push(...validateSatisfiedTranscriptHistory({ path: path.replace(AGGREGATE_CLOSURE_DIRECTORY, "governance/public-npm-aggregate-transcripts"), history }));
  } catch (error) { findings.push({ rule: "closure", message: `${path}: ${error.message}` }); }
}
if (findings.length) { for (const item of findings) console.error(`- [${item.rule}] ${item.message}`); process.exitCode = 1; }
else console.log(`PUBLIC NPM AGGREGATE CLOSURES OK — ${files.length} immutable complete closure(s).`);
