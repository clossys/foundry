#!/usr/bin/env node
/**
 * check:fast-before-review (rule R-FAST-BEFORE-REVIEW, owner_agent reviewer): every executor runs
 * `clossys check --fast` before DONE, and review starts only on a FAST PASS record at the exact head.
 *
 * Two findings, both mechanical:
 *
 *   missing-rule   packages/reviewer/skill/SKILL.md (under --root) does not state RULE_TEXT verbatim,
 *                  so the agent that owns the gate no longer tells executors and reviewers to use it;
 *   not-fast-pass  a record given with --record is not a clossys.fast-check/1 FAST PASS record that ran
 *                  at least one command (a FAIL, an INCOMPLETE, or nothing checked never opens review);
 *   wrong-head     the record is a FAST PASS, but for another commit than --head: a pass at an earlier
 *                  head says nothing about this one.
 *
 * With no --record it checks the skill only (the root `check` step). Before a review starts, the
 * reviewer (or the planner's gate) runs it with the executor's `clossys check --fast --json` record and
 * the head under review:
 *
 *   node scripts/check-fast-before-review.mjs [--root DIR] [--record <fast.json> --head <sha>] [--json]
 *
 * Exit 0 when nothing is found, 1 on a finding, 2 on a usage or read error. Plain node: no build.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL = "packages/reviewer/skill/SKILL.md";
export const RULE_TEXT = "Every executor runs `clossys check --fast` before DONE; review starts only on a FAST PASS record at the exact head.";
export const FAST_SCHEMA = "clossys.fast-check/1";
const SHA = /^[0-9a-f]{40}$/;

class UsageError extends Error {}

export function parseArgs(argv) {
  const out = { root: undefined, record: undefined, head: undefined, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = () => { const next = argv[++index]; if (next === undefined || next.startsWith("--")) throw new UsageError(`${arg} needs a value`); return next; };
    if (arg === "--root") out.root = value();
    else if (arg === "--record") out.record = value();
    else if (arg === "--head") out.head = value();
    else if (arg === "--json") out.json = true;
    else throw new UsageError(`unexpected argument ${arg}`);
  }
  if ((out.record === undefined) !== (out.head === undefined)) throw new UsageError("--record and --head go together: a record is judged against the head under review");
  if (out.head !== undefined && !SHA.test(out.head)) throw new UsageError("--head must be a full 40-character commit sha");
  return out;
}

/** The skill finding: the Reviewer skill states the rule verbatim. */
export function skillFindings(root) {
  const path = join(root, SKILL);
  if (!existsSync(path)) return [{ rule: "missing-rule", path: SKILL, message: `${SKILL} does not exist; it must state: ${RULE_TEXT}` }];
  return readFileSync(path, "utf8").includes(RULE_TEXT) ? [] : [{ rule: "missing-rule", path: SKILL, message: `${SKILL} does not state the rule: ${RULE_TEXT}` }];
}

/** The record findings: a FAST PASS record that ran something, at exactly head. */
export function recordFindings(record, head, path = "record") {
  if (!record || typeof record !== "object" || record.schema !== FAST_SCHEMA) return [{ rule: "not-fast-pass", path, message: `${path} is not a ${FAST_SCHEMA} record` }];
  if (record.verdict !== "FAST PASS" || record.line !== `FAST PASS ${record.head}`) return [{ rule: "not-fast-pass", path, message: `${path} records ${record.verdict ?? "no verdict"}, not FAST PASS: review does not start` }];
  if (!Array.isArray(record.commands) || record.commands.length === 0) return [{ rule: "not-fast-pass", path, message: `${path} records a pass that ran no command: nothing checked is never a pass` }];
  if (record.head !== head) return [{ rule: "wrong-head", path, message: `${path} is a FAST PASS at ${record.head}, not at the head under review ${head}` }];
  return [];
}

export function run(argv) {
  const args = parseArgs(argv);
  const root = resolve(args.root ?? join(fileURLToPath(new URL(".", import.meta.url)), ".."));
  const findings = skillFindings(root);
  if (args.record !== undefined) {
    let record;
    try { record = JSON.parse(readFileSync(resolve(args.record), "utf8")); }
    catch (error) { throw new UsageError(`cannot read the record at ${args.record}: ${error.message}`); }
    findings.push(...recordFindings(record, args.head, args.record));
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  try {
    const findings = run(argv);
    if (argv.includes("--json")) console.log(JSON.stringify({ findings }, null, 2));
    else {
      for (const finding of findings) console.log(`${finding.rule}\t${finding.path}\t${finding.message}`);
      console.log(`check:fast-before-review: ${findings.length} finding(s)`);
    }
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`check:fast-before-review: ${error.message}`);
    process.exitCode = 2;
  }
}
