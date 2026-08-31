#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { AGGREGATE_CANARY_PATH, aggregateCanaryGitHistory, validateAggregateCanary, validateAggregateCanaryAppendOnly, validateAggregateCanaryHistory } from "./lib/public-npm-aggregate-canary.mjs";

const root = process.cwd();
const record = JSON.parse(readFileSync(AGGREGATE_CANARY_PATH, "utf8"));
const history = aggregateCanaryGitHistory({ root });
const findings = [
  ...validateAggregateCanary(record, { read: (path) => readFileSync(`${root}/${path}`, "utf8") }),
  ...validateAggregateCanaryAppendOnly(record, { root }),
  ...validateAggregateCanaryHistory({ history }),
];
if (findings.length) {
  console.error("PUBLIC NPM AGGREGATE CANARY RECORD INVALID");
  for (const item of findings) console.error(`- [${item.rule}] ${item.message}`);
  process.exitCode = 1;
} else {
  console.log(`PUBLIC NPM AGGREGATE CANARY RECORD OK — ${record.sets.length} frozen 19-package identity set(s); publication closures are absent, so no live public-canary pass is claimed.`);
}
