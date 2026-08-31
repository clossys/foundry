#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { AGGREGATE_CANARY_PATH, AGGREGATE_CLOSURE_DIRECTORY, AGGREGATE_TRANSCRIPT_DIRECTORY, aggregateCanaryGitHistory, immutableRecordPaths, validateAggregateCanary, validateAggregateCanaryAppendOnly, validateAggregateCanaryHistory, validateAggregateRecordSets } from "./lib/public-npm-aggregate-canary.mjs";

const root = process.cwd();
const record = JSON.parse(readFileSync(AGGREGATE_CANARY_PATH, "utf8"));
const history = aggregateCanaryGitHistory({ root });
const closureRecords = immutableRecordPaths({ root, directory: AGGREGATE_CLOSURE_DIRECTORY });
const transcriptRecords = immutableRecordPaths({ root, directory: AGGREGATE_TRANSCRIPT_DIRECTORY });
const findings = [
  ...validateAggregateCanary(record, { read: (path) => readFileSync(`${root}/${path}`, "utf8") }),
  ...validateAggregateCanaryAppendOnly(record, { root }),
  ...validateAggregateCanaryHistory({ history }),
  ...validateAggregateRecordSets({
    closureRecords,
    transcriptRecords,
    readTranscript: (path) => JSON.parse(execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8" })),
  }),
];
if (findings.length) {
  console.error("PUBLIC NPM AGGREGATE CANARY RECORD INVALID");
  for (const item of findings) console.error(`- [${item.rule}] ${item.message}`);
  process.exitCode = 1;
} else {
  console.log(`PUBLIC NPM AGGREGATE CANARY RECORD OK — ${record.sets.length} frozen 19-package identity set(s); publication closures are absent, so no live public-canary pass is claimed.`);
}
