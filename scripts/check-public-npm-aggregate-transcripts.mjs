#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AGGREGATE_CANARY_PATH, AGGREGATE_TRANSCRIPT_DIRECTORY, validateSatisfiedAggregateTranscript, validateSatisfiedTranscriptHistory } from "./lib/public-npm-aggregate-canary.mjs";

const root = process.cwd();
const plan = JSON.parse(readFileSync(join(root, AGGREGATE_CANARY_PATH), "utf8"));
const files = existsSync(join(root, AGGREGATE_TRANSCRIPT_DIRECTORY))
  ? execFileSync("git", ["ls-files", "--", AGGREGATE_TRANSCRIPT_DIRECTORY], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean)
  : [];
const findings = [];
for (const path of files) {
  let transcript;
  try { transcript = JSON.parse(readFileSync(join(root, path), "utf8")); }
  catch { findings.push({ rule: "json", message: `${path} is not JSON` }); continue; }
  const rows = execFileSync("git", ["log", "--format=%H", "--name-status", "--follow", "--", path], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  const history = [];
  let commit = null;
  for (const row of rows) {
    if (/^[a-f0-9]{40}$/.test(row)) { commit = row; continue; }
    const [status, changed] = row.split("\t");
    if (changed === path && commit) {
      const sha256 = execFileSync("git", ["show", `${commit}:${path}`], { cwd: root, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] });
      const { createHash } = await import("node:crypto");
      history.push({ commit, status, sha256: createHash("sha256").update(sha256).digest("hex") });
    }
  }
  let closure = null;
  try { closure = JSON.parse(readFileSync(join(root, transcript.plan?.closurePath ?? ""), "utf8")); }
  catch { findings.push({ rule: "closure", message: `${path} does not retain a readable immutable closure` }); }
  findings.push(...validateSatisfiedAggregateTranscript(transcript, { plan, closure }), ...validateSatisfiedTranscriptHistory({ path, history }));
}
if (findings.length) {
  console.error("PUBLIC NPM AGGREGATE TRANSCRIPT INVALID");
  for (const item of findings) console.error(`- [${item.rule}] ${item.message}`);
  process.exitCode = 1;
} else console.log(`PUBLIC NPM AGGREGATE TRANSCRIPT RECORDS OK — ${files.length} immutable satisfied record(s).`);
