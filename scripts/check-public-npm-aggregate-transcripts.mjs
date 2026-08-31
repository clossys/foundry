#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AGGREGATE_CANARY_PATH, AGGREGATE_TRANSCRIPT_DIRECTORY, immutableRecordHistory, immutableRecordPaths, isAggregateClosurePath, validateSatisfiedAggregateTranscript, validateSatisfiedTranscriptHistory } from "./lib/public-npm-aggregate-canary.mjs";

const root = process.cwd();
const plan = JSON.parse(readFileSync(join(root, AGGREGATE_CANARY_PATH), "utf8"));
const records = immutableRecordPaths({ root, directory: AGGREGATE_TRANSCRIPT_DIRECTORY });
const files = records.introduced;
const findings = [];
for (const path of records.current) if (!records.introduced.includes(path)) findings.push({ rule: "transcript-introduction", message: `${path} has no exact A introduction in the closed immutable namespace` });
for (const path of files) {
  if (!records.current.includes(path)) { findings.push({ rule: "transcript-presence", message: `${path} was introduced as immutable satisfied evidence but is absent at HEAD` }); continue; }
  let transcript;
  try { transcript = JSON.parse(readFileSync(join(root, path), "utf8")); }
  catch { findings.push({ rule: "json", message: `${path} is not JSON` }); continue; }
  const history = immutableRecordHistory({ root, path });
  let closure = null;
  if (!transcript.plan || !isAggregateClosurePath(transcript.plan.closurePath)) findings.push({ rule: "closure-path", message: `${path} does not retain a closed immutable closure path` });
  else try { closure = JSON.parse(readFileSync(join(root, transcript.plan.closurePath), "utf8")); }
  catch { findings.push({ rule: "closure", message: `${path} does not retain a readable immutable closure` }); }
  findings.push(...validateSatisfiedAggregateTranscript(transcript, { plan, closure }), ...validateSatisfiedTranscriptHistory({ path, history }));
}
if (findings.length) {
  console.error("PUBLIC NPM AGGREGATE TRANSCRIPT INVALID");
  for (const item of findings) console.error(`- [${item.rule}] ${item.message}`);
  process.exitCode = 1;
} else console.log(`PUBLIC NPM AGGREGATE TRANSCRIPT RECORDS OK — ${files.length} immutable satisfied record(s).`);
