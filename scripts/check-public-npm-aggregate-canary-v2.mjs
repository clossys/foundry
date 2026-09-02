#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  AGGREGATE_V2_CANARY_PATH,
  AGGREGATE_V2_CLOSURE_DIRECTORY,
  AGGREGATE_V2_TRANSCRIPT_DIRECTORY,
  aggregateV2GitHistory,
  aggregateV2RecordHistory,
  aggregateV2RecordPaths,
  aggregateV2ClosurePath,
  aggregateV2TranscriptPath,
  isAggregateV2ClosurePath,
  validateAggregateV2Closure,
  validateAggregateV2Plan,
  validateAggregateV2PlanHistory,
  validateAggregateV2RecordSets,
  validateAggregateV2Transcript,
} from "./lib/public-npm-aggregate-canary-v2.mjs";

const root = process.cwd();
const readHead = (path) => execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const regular = (path) => execFileSync("git", ["ls-tree", "HEAD", "--", path], { cwd: root, encoding: "utf8" }).startsWith("100644 ");
const parentCount = (commit) => execFileSync("git", ["rev-list", "--parents", "-n", "1", commit], { cwd: root, encoding: "utf8" }).trim().split(/\s+/).length - 1;
const plan = JSON.parse(readHead(AGGREGATE_V2_CANARY_PATH));
const closureRecords = aggregateV2RecordPaths({ root, directory: AGGREGATE_V2_CLOSURE_DIRECTORY });
const transcriptRecords = aggregateV2RecordPaths({ root, directory: AGGREGATE_V2_TRANSCRIPT_DIRECTORY });
const findings = [
  ...validateAggregateV2Plan(plan, { read: readHead }),
  ...validateAggregateV2PlanHistory({ history: aggregateV2GitHistory({ root }), parentCount }),
  ...validateAggregateV2RecordSets({ closureRecords, transcriptRecords }),
];
for (const [directory, kind, pathFor, validate] of [
  [AGGREGATE_V2_CLOSURE_DIRECTORY, "closure", aggregateV2ClosurePath, (value) => validateAggregateV2Closure(value, plan, { read: readHead, root })],
  [AGGREGATE_V2_TRANSCRIPT_DIRECTORY, "transcript", aggregateV2TranscriptPath, (value) => {
    if (!isAggregateV2ClosurePath(value?.closure?.path)) return [{ rule: "transcript-closure", message: "transcript closure path is outside the closed v2 closure namespace" }];
    const closure = JSON.parse(readHead(value.closure?.path));
    return validateAggregateV2Transcript(value, plan, closure, { read: readHead });
  }],
]) {
  const records = aggregateV2RecordPaths({ root, directory });
  for (const path of records.current) {
    if (!records.introduced.includes(path) || !regular(path)) { findings.push({ rule: `${kind}-history`, message: `${path} must be a regular, introduced immutable record` }); continue; }
    const history = aggregateV2RecordHistory({ root, path });
    if (history.length !== 1 || history[0].status !== "A" || parentCount(history[0].commit) !== 1) { findings.push({ rule: `${kind}-history`, message: `${path} must have one direct single-parent introduction` }); continue; }
    try {
      const value = JSON.parse(readHead(path));
      if (path !== pathFor(value.canonicalSha256)) findings.push({ rule: `${kind}-path`, message: `${path} is not content-addressed by its exact canonical digest` });
      findings.push(...validate(value));
    } catch { findings.push({ rule: `${kind}-read`, message: `${path} is unreadable or lacks its immutable closure` }); }
  }
}
if (findings.length) {
  console.error("PUBLIC NPM AGGREGATE CANARY V2 INVALID");
  for (const item of findings) console.error(`- [${item.rule}] ${item.message}`);
  process.exitCode = 1;
} else console.log("PUBLIC NPM AGGREGATE CANARY V2 OK — immutable current-release plan retained; no pass is claimed without a complete closure and transcript.");
