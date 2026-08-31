#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import { AGGREGATE_CANARY_PATH, AGGREGATE_CLOSURE_DIRECTORY, aggregateClosurePath, immutableRecordHistory, immutableRecordPaths, isAggregateClosurePath, validateAggregateClosure, validateSatisfiedTranscriptHistory } from "./lib/public-npm-aggregate-canary.mjs";

const root = process.cwd();
const readHead = (path) => execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const regularHead = (path) => execFileSync("git", ["ls-tree", "HEAD", "--", path], { cwd: root, encoding: "utf8" }).startsWith("100644 ");
const plan = JSON.parse(readHead(AGGREGATE_CANARY_PATH));
const records = immutableRecordPaths({ root, directory: AGGREGATE_CLOSURE_DIRECTORY });
const files = records.introduced;
const findings = [];
for (const path of records.current) if (!records.introduced.includes(path)) findings.push({ rule: "closure-introduction", message: `${path} has no exact A introduction in the closed immutable namespace` });
for (const path of files) {
  if (!records.current.includes(path)) { findings.push({ rule: "closure-presence", message: `${path} was introduced as immutable closure evidence but is absent at HEAD` }); continue; }
  try {
    if (!regularHead(path)) throw new Error("immutable closure must be a regular HEAD blob");
    const closure = JSON.parse(readHead(path));
    if (!isAggregateClosurePath(path) || path !== aggregateClosurePath(closure.set, closure.canonicalSha256)) findings.push({ rule: "closure-path", message: `${path} is not content-addressed by its closed closure digest` });
    findings.push(...validateAggregateClosure(plan, closure, { path, read: (evidencePath) => {
      if (!regularHead(evidencePath)) throw new Error("immutable closure evidence must be a regular HEAD blob");
      return readHead(evidencePath);
    } }));
    findings.push(...validateSatisfiedTranscriptHistory({ path: path.replace(AGGREGATE_CLOSURE_DIRECTORY, "governance/public-npm-aggregate-transcripts"), history: immutableRecordHistory({ root, path }) }));
  } catch (error) { findings.push({ rule: "closure", message: `${path}: ${error.message}` }); }
}
if (findings.length) { for (const item of findings) console.error(`- [${item.rule}] ${item.message}`); process.exitCode = 1; }
else console.log(`PUBLIC NPM AGGREGATE CLOSURES OK — ${files.length} immutable complete closure(s).`);
