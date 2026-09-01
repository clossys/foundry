#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  AGGREGATE_V2_CANARY_PATH,
  AGGREGATE_V2_CLOSURE_DIRECTORY,
  AGGREGATE_V2_TRANSCRIPT_DIRECTORY,
  aggregateV2GitHistory,
  aggregateV2RecordPaths,
  aggregateV2RecordHistory,
  validateAggregateV2Plan,
  validateAggregateV2PlanAppendOnly,
  validateAggregateV2PlanHistory,
  validateAggregateV2RecordSets,
} from "./lib/public-npm-aggregate-canary-v2.mjs";

const root = process.cwd();
const plan = JSON.parse(readFileSync(AGGREGATE_V2_CANARY_PATH, "utf8"));
const read = (path) => readFileSync(path, "utf8");
const trackedPlan = (() => { try { execFileSync("git", ["ls-files", "--error-unmatch", AGGREGATE_V2_CANARY_PATH], { cwd: root, stdio: "ignore" }); return true; } catch { return false; } })();
const recordsFor = (directory) => {
  try {
    const listing = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", directory], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return listing.trim() ? aggregateV2RecordPaths({ root, directory }) : { introduced: [], current: [] };
  } catch { return { introduced: [], current: [] }; }
};
const closureRecords = recordsFor(AGGREGATE_V2_CLOSURE_DIRECTORY);
const transcriptRecords = recordsFor(AGGREGATE_V2_TRANSCRIPT_DIRECTORY);
const findings = [
  ...validateAggregateV2Plan(plan, { read }),
  ...validateAggregateV2PlanAppendOnly(plan, { root }),
  ...validateAggregateV2PlanHistory({ root, history: trackedPlan ? aggregateV2GitHistory({ root }) : [] }),
  ...validateAggregateV2RecordSets({
    closureRecords,
    transcriptRecords,
  }),
];
for (const [directory, records] of [[AGGREGATE_V2_CLOSURE_DIRECTORY, closureRecords], [AGGREGATE_V2_TRANSCRIPT_DIRECTORY, transcriptRecords]]) {
  for (const path of records.current) {
    if (!execFileSync("git", ["ls-tree", "HEAD", "--", path], { cwd: root, encoding: "utf8" }).startsWith("100644 ")) findings.push({ rule: "record-regular", message: `${path} must be a regular immutable blob in ${directory}` });
    const history = aggregateV2RecordHistory({ root, path });
    if (history.length !== 1 || history[0].status !== "A") findings.push({ rule: "record-history", message: `${path} must have one introduction and no rewrite/delete/rename` });
  }
}
if (findings.length) {
  console.error("PUBLIC NPM AGGREGATE CANARY V2 RECORD INVALID");
  for (const item of findings) console.error(`- [${item.rule}] ${item.message}`);
  process.exitCode = 1;
} else {
  console.log(`PUBLIC NPM AGGREGATE CANARY V2 RECORD OK — ${plan.sets[0].packages.length}-package current-release plan; closure/transcript remain absent until publication evidence exists.`);
}
