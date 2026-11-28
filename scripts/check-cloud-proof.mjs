#!/usr/bin/env node
/**
 * check:cloud-proof (rule R-REVIEW-CLOUD-PROOF, owner_agent reviewer): a cloud unit's own gate result is the
 * Reviewer's mechanical proof only when it is imported at the exact unit head, and a cloud FAIL is never overridden.
 *
 * Findings, all mechanical:
 *
 *   missing-rule           packages/reviewer/skill/SKILL.md (under --root) does not state CLOUD_PROOF_TEXT verbatim;
 *   cloud-head-mismatch    a record given with --record was written by `clossys review --import` (it has an
 *                          `imported` field) for another head or tree than the one it records: the gate result is
 *                          the proof of its own head only;
 *   cloud-fail-overridden  that record's cloud gate verdict (`imported.gateVerdict`) is FAIL, but the record, or its
 *                          verdict line, says PASS: a cloud FAIL imports as FAIL and the next step is a local run.
 *
 * A record without `imported` (a local run) has no cloud-proof finding. With no --record it checks the skill only.
 *
 *   node scripts/check-cloud-proof.mjs [--root DIR] [--record <review.json>]... [--json]
 *
 * Exit 0 when nothing is found, 1 on a finding, 2 on a usage or read error. Plain node: no build.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL = "packages/reviewer/skill/SKILL.md";
export const CLOUD_PROOF_TEXT = "A cloud unit's own gate result, imported at the exact unit head and tree over the recorded base with every packet command run, is its mechanical proof; a cloud FAIL is never overridden, and this machine re-runs only the merged batch tip.";
const VERDICT_LINE = /^MECHANICAL: (PASS|FAIL) (\S+) (\S+)$/;

class UsageError extends Error {}

export function parseArgs(argv) {
  const out = { root: undefined, records: [], json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = () => { const next = argv[++index]; if (next === undefined || next.startsWith("--")) throw new UsageError(`${arg} needs a value`); return next; };
    if (arg === "--root") out.root = value();
    else if (arg === "--record") out.records.push(value());
    else if (arg === "--json") out.json = true;
    else throw new UsageError(`unexpected argument ${arg}`);
  }
  return out;
}

/** The skill finding: the Reviewer skill states the rule verbatim. */
export function skillFindings(root) {
  const path = join(root, SKILL);
  if (!existsSync(path)) return [{ rule: "missing-rule", path: SKILL, message: `${SKILL} does not exist` }];
  return readFileSync(path, "utf8").includes(CLOUD_PROOF_TEXT) ? [] : [{ rule: "missing-rule", path: SKILL, message: `${SKILL} does not state the rule: ${CLOUD_PROOF_TEXT}` }];
}

/** The record findings of an imported record: its own head and tree, and a cloud FAIL kept FAIL. */
export function recordFindings(record, path = "record") {
  const imported = record && typeof record === "object" ? record.imported : undefined;
  if (!imported || typeof imported !== "object") return [];
  const findings = [];
  const line = typeof record.line === "string" ? VERDICT_LINE.exec(record.line) : null;
  if (imported.head !== record.head || imported.tree !== record.tree || (line && (line[2] !== imported.head || line[3] !== imported.tree))) {
    findings.push({ rule: "cloud-head-mismatch", path, message: `${path} was imported for ${String(imported.head).slice(0, 12)} (tree ${String(imported.tree).slice(0, 12)}) but records ${String(record.head).slice(0, 12)} (tree ${String(record.tree).slice(0, 12)}): a gate result proves its own head only` });
  }
  if (imported.gateVerdict !== "PASS" && (record.verdict !== "FAIL" || !line || line[1] !== "FAIL")) {
    findings.push({ rule: "cloud-fail-overridden", path, message: `${path} imports a cloud gate ${String(imported.gateVerdict)} as ${String(record.verdict)}: a cloud FAIL imports as FAIL, and the next step is a local run` });
  }
  return findings;
}

const readJson = (file) => {
  try { return JSON.parse(readFileSync(resolve(file), "utf8")); }
  catch (error) { throw new UsageError(`cannot read ${file}: ${error.message}`); }
};

export function run(argv) {
  const args = parseArgs(argv);
  const root = resolve(args.root ?? join(fileURLToPath(new URL(".", import.meta.url)), ".."));
  const findings = skillFindings(root);
  for (const file of args.records) findings.push(...recordFindings(readJson(file), file));
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  try {
    const findings = run(argv);
    if (argv.includes("--json")) console.log(JSON.stringify({ findings }, null, 2));
    else {
      for (const finding of findings) console.log(`${finding.rule}\t${finding.path}\t${finding.message}`);
      console.log(`check:cloud-proof: ${findings.length} finding(s)`);
    }
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`check:cloud-proof: ${error.message}`);
    process.exitCode = 2;
  }
}
