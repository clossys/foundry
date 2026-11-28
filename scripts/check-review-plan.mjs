#!/usr/bin/env node
/**
 * check:review-plan (rules R-REVIEW-BUDGET and R-REVIEW-CARRY, owner_agent reviewer): the Reviewer states the review
 * budget and the clearance carry-over rule, and the records `clossys review verdict` and `clossys review carry` write
 * keep them (packages/producer/src/review/plan.ts and carry.ts apply both; this check judges what was recorded).
 *
 * Findings, all mechanical:
 *
 *   missing-rule        packages/reviewer/skill/SKILL.md (under --root) does not state BUDGET_TEXT or CARRY_TEXT
 *                       verbatim;
 *   malformed-verdict   a line of a --verdicts log is not a clossys.review-verdict/1 record whose `line` is
 *                       `CLEAR <head>` or `NOT CLEAR <head>: <reason>` for its verdict, with a role and a
 *                       severity on a NOT CLEAR;
 *   unattested-blind    a blind or second-blind verdict without the blind attestation (`blind: true`: no other
 *                       review file was read for that unit);
 *   final-pass          a verdict for a final pass: the budget has none, and never after a CLEAR blind;
 *   extra-blind         a unit with two blind, or two second-blind, verdicts: the budget gives one of each at most;
 *   third-fix-round     a verdict recorded after a unit's third NOT CLEAR: at most 2 fix rounds;
 *   carry-on-own-path   a --carry record (clossys.review-carry/1) that says CARRY although an own path's blob
 *                       changed, or whose line does not agree with its verdict.
 *
 *   node scripts/check-review-plan.mjs [--root DIR] [--verdicts <log.jsonl>]... [--carry <carry.json>]... [--json]
 *
 * Exit 0 when nothing is found, 1 on a finding, 2 on a usage or read error. Plain node: no build.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL = "packages/reviewer/skill/SKILL.md";
export const BUDGET_TEXT = "Mechanical first; a gate diff gets one blind pass, and a second blind only when it changes a check's pass/fail logic or the first blind finds a P0 or P1; no final after a CLEAR blind; one closure delta per fix round; at most 2 fix rounds.";
export const CARRY_TEXT = "A clearance carries to a new head only over a mechanical default-branch carry; any change to the blob of one of the unit's own paths voids it.";
export const FIX_CAP = 2;
const ROLES = new Set(["blind", "second-blind", "closure-delta", "final"]);
const SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);
const SHA = /^[0-9a-f]{7,64}$/;

class UsageError extends Error {}

export function parseArgs(argv) {
  const out = { root: undefined, verdicts: [], carries: [], json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = () => { const next = argv[++index]; if (next === undefined || next.startsWith("--")) throw new UsageError(`${arg} needs a value`); return next; };
    if (arg === "--root") out.root = value();
    else if (arg === "--verdicts") out.verdicts.push(value());
    else if (arg === "--carry") out.carries.push(value());
    else if (arg === "--json") out.json = true;
    else throw new UsageError(`unexpected argument ${arg}`);
  }
  return out;
}

/** The skill findings: the Reviewer skill states both rules verbatim. */
export function skillFindings(root) {
  const path = join(root, SKILL);
  if (!existsSync(path)) return [{ rule: "missing-rule", path: SKILL, message: `${SKILL} does not exist` }];
  const text = readFileSync(path, "utf8");
  return [BUDGET_TEXT, CARRY_TEXT].filter(rule => !text.includes(rule)).map(rule => ({ rule: "missing-rule", path: SKILL, message: `${SKILL} does not state the rule: ${rule}` }));
}

const expectedLine = (record) => record.verdict === "CLEAR" ? `CLEAR ${record.head}` : `NOT CLEAR ${record.head}: ${record.reason}`;

/** Why one parsed verdict record is malformed, or null. */
function malformed(record) {
  if (!record || typeof record !== "object" || record.schema !== "clossys.review-verdict/1") return "not a clossys.review-verdict/1 record";
  if (typeof record.unit !== "string" || !record.unit) return "no unit";
  if (!ROLES.has(record.role)) return `role ${JSON.stringify(record.role)} is not blind, second-blind or closure-delta`;
  if (typeof record.head !== "string" || !SHA.test(record.head)) return "head is not a commit sha";
  if (record.verdict !== "CLEAR" && record.verdict !== "NOT CLEAR") return "verdict is not CLEAR or NOT CLEAR";
  if (record.verdict === "NOT CLEAR" && (typeof record.reason !== "string" || !record.reason.trim() || !SEVERITIES.has(record.severity))) return "a NOT CLEAR needs a reason and a severity P0-P3";
  if (record.line !== expectedLine(record)) return `its line is not ${JSON.stringify(expectedLine(record))}`;
  return null;
}

/** The verdict-log findings over one log's text. */
export function verdictFindings(text, path = "verdicts") {
  const findings = [];
  const units = new Map();
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const at = `${path}:${index + 1}`;
    let record;
    try { record = JSON.parse(line); } catch { findings.push({ rule: "malformed-verdict", path: at, message: `${at} is not JSON` }); return; }
    const why = malformed(record);
    if (why) { findings.push({ rule: "malformed-verdict", path: at, message: `${at}: ${why}` }); return; }
    if (record.role === "final") findings.push({ rule: "final-pass", path: at, message: `${at} records a final pass for ${record.unit}: the budget has no final, and none after a CLEAR blind` });
    if ((record.role === "blind" || record.role === "second-blind") && record.blind !== true) findings.push({ rule: "unattested-blind", path: at, message: `${at}: a ${record.role} verdict without the blind attestation (no other review file was read for that unit)` });
    const unit = units.get(record.unit) ?? { blind: 0, second: 0, notClear: 0 };
    units.set(record.unit, unit);
    if (unit.notClear > FIX_CAP) findings.push({ rule: "third-fix-round", path: at, message: `${at}: a ${record.role} for ${record.unit} after NOT CLEAR number ${unit.notClear}: at most ${FIX_CAP} fix rounds` });
    if (record.role === "blind" && ++unit.blind > 1) findings.push({ rule: "extra-blind", path: at, message: `${at}: a second blind verdict for ${record.unit}: one blind pass, then second-blind or closure delta` });
    if (record.role === "second-blind" && ++unit.second > 1) findings.push({ rule: "extra-blind", path: at, message: `${at}: a second second-blind verdict for ${record.unit}` });
    if (record.verdict === "NOT CLEAR") unit.notClear++;
  });
  return findings;
}

/** The carry-record findings: a CARRY never stands over an own-path blob change. */
export function carryFindings(record, path = "carry") {
  if (!record || typeof record !== "object" || record.schema !== "clossys.review-carry/1" || (record.verdict !== "CARRY" && record.verdict !== "VOID")) return [{ rule: "carry-on-own-path", path, message: `${path} is not a clossys.review-carry/1 record with a CARRY or VOID verdict` }];
  const findings = [];
  if (typeof record.line !== "string" || !record.line.startsWith(`${record.verdict} ${record.head}: `)) findings.push({ rule: "carry-on-own-path", path, message: `${path}: its line does not agree with its ${record.verdict}` });
  const changed = Array.isArray(record.ownChanged) ? record.ownChanged : [];
  if (record.verdict === "CARRY" && changed.length) findings.push({ rule: "carry-on-own-path", path, message: `${path} says CARRY although own path(s) changed blob: ${changed.slice(0, 3).join(", ")}` });
  return findings;
}

const readText = (file) => {
  try { return readFileSync(resolve(file), "utf8"); }
  catch (error) { throw new UsageError(`cannot read ${file}: ${error.message}`); }
};
const readJson = (file) => {
  const text = readText(file);
  try { return JSON.parse(text); } catch (error) { throw new UsageError(`${file} is not JSON: ${error.message}`); }
};

export function run(argv) {
  const args = parseArgs(argv);
  const root = resolve(args.root ?? join(fileURLToPath(new URL(".", import.meta.url)), ".."));
  const findings = skillFindings(root);
  for (const file of args.verdicts) findings.push(...verdictFindings(readText(file), file));
  for (const file of args.carries) findings.push(...carryFindings(readJson(file), file));
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  try {
    const findings = run(argv);
    if (argv.includes("--json")) console.log(JSON.stringify({ findings }, null, 2));
    else {
      for (const finding of findings) console.log(`${finding.rule}\t${finding.path}\t${finding.message}`);
      console.log(`check:review-plan: ${findings.length} finding(s)`);
    }
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`check:review-plan: ${error.message}`);
    process.exitCode = 2;
  }
}
