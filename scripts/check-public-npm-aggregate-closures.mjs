#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AGGREGATE_CANARY_PATH, AGGREGATE_CLOSURE_DIRECTORY, aggregateClosurePath, immutableRecordHistory, immutableRecordPaths, isAggregateClosurePath, validateAggregateClosure, validateSatisfiedTranscriptHistory } from "./lib/public-npm-aggregate-canary.mjs";

const root = process.cwd();
const plan = JSON.parse(readFileSync(join(root, AGGREGATE_CANARY_PATH), "utf8"));
const records = immutableRecordPaths({ root, directory: AGGREGATE_CLOSURE_DIRECTORY });
const files = records.introduced;
const findings = [];
for (const path of records.current) if (!records.introduced.includes(path)) findings.push({ rule: "closure-introduction", message: `${path} has no exact A introduction in the closed immutable namespace` });
for (const path of files) {
  if (!records.current.includes(path)) { findings.push({ rule: "closure-presence", message: `${path} was introduced as immutable closure evidence but is absent at HEAD` }); continue; }
  try {
    const closure = JSON.parse(readFileSync(join(root, path), "utf8"));
    if (!isAggregateClosurePath(path) || path !== aggregateClosurePath(closure.set, closure.canonicalSha256)) findings.push({ rule: "closure-path", message: `${path} is not content-addressed by its closed closure digest` });
    findings.push(...validateAggregateClosure(plan, closure, { path, read: (evidencePath) => readFileSync(join(root, evidencePath), "utf8") }));
    findings.push(...validateSatisfiedTranscriptHistory({ path: path.replace(AGGREGATE_CLOSURE_DIRECTORY, "governance/public-npm-aggregate-transcripts"), history: immutableRecordHistory({ root, path }) }));
  } catch (error) { findings.push({ rule: "closure", message: `${path}: ${error.message}` }); }
}
if (findings.length) { for (const item of findings) console.error(`- [${item.rule}] ${item.message}`); process.exitCode = 1; }
else console.log(`PUBLIC NPM AGGREGATE CLOSURES OK — ${files.length} immutable complete closure(s).`);
