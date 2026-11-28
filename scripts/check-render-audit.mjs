#!/usr/bin/env node
/**
 * check:render-audit (rule R-RENDER-AUDIT, owner_agent reviewer): visible defects are caught by one generic
 * rendered-output audit, `clossys check --render` (packages/producer/src/check/render-check.ts), never patched page
 * by page, and that audit fails closed and attributes every finding.
 *
 * Findings, all mechanical:
 *
 *   missing-rule          packages/reviewer/skill/SKILL.md (under --root) does not state RENDER_TEXT verbatim;
 *   no-verdict            a record given with --record is not a clossys.render-check/1 record whose last line
 *                         (`line`) is `RENDER: <verdict> ...` agreeing with its verdict;
 *   pass-on-nothing       the record is a PASS that captured nothing (ran.commands 0, or no captured route);
 *   pass-on-missing       the record is a PASS although something was missing (ran.missing: a browser, a build);
 *   pass-with-findings    the record is a PASS that holds findings;
 *   unattributed-finding  a finding does not name its owning slot (a `slot` key: `<agent>/<slot>` or null) and
 *                         the agent it goes to, so it cannot be filed to its owner.
 *
 *   node scripts/check-render-audit.mjs [--root DIR] [--record <render.json>]... [--json]
 *
 * Exit 0 when nothing is found, 1 on a finding, 2 on a usage or read error. Plain node: no build.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL = "packages/reviewer/skill/SKILL.md";
export const RENDER_TEXT = "Visible defects are caught by the one rendered-output audit, `clossys check --render`, never patched page by page; it fails closed (no routes, zero captures, no browser or no build is FAIL), and every finding names its owning slot and agent and is filed as a request.";
const SCHEMA = "clossys.render-check/1";
const LINE = /^RENDER: (PASS|FAIL) \S+/;
const SLOT = /^[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/;

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
  return readFileSync(path, "utf8").includes(RENDER_TEXT) ? [] : [{ rule: "missing-rule", path: SKILL, message: `${SKILL} does not state the rule: ${RENDER_TEXT}` }];
}

/** The record findings over a `clossys check --render --json` record. */
export function recordFindings(record, path = "record") {
  const verdict = record && typeof record === "object" && record.schema === SCHEMA ? record.verdict : undefined;
  const match = typeof record?.line === "string" ? LINE.exec(record.line) : null;
  if ((verdict !== "PASS" && verdict !== "FAIL") || !match || match[1] !== verdict) return [{ rule: "no-verdict", path, message: `${path} is not a ${SCHEMA} record with a RENDER: line agreeing with its verdict: a missing verdict is FAIL` }];
  const findings = [];
  const list = Array.isArray(record.findings) ? record.findings : [];
  list.forEach((item, index) => {
    const slot = item?.slot;
    if (!(item && Object.hasOwn(item, "slot") && (slot === null || (typeof slot === "string" && SLOT.test(slot)))) || typeof item.agent !== "string" || !item.agent) {
      findings.push({ rule: "unattributed-finding", path, message: `${path} finding ${index + 1} (${String(item?.rule)}) names no owning slot and agent: it cannot be filed to its owner` });
    }
  });
  if (verdict !== "PASS") return findings;
  const routes = Array.isArray(record.routes) ? record.routes : [];
  const captured = routes.filter(route => route?.captured === true).length;
  if (!Number.isInteger(record.ran?.commands) || record.ran.commands === 0 || captured === 0) findings.push({ rule: "pass-on-nothing", path, message: `${path} is a PASS that captured no route: nothing rendered is never a pass` });
  const missing = Array.isArray(record.ran?.missing) ? record.ran.missing : [];
  if (missing.length) findings.push({ rule: "pass-on-missing", path, message: `${path} is a PASS although ${missing.join("; ")} was missing` });
  if (list.length) findings.push({ rule: "pass-with-findings", path, message: `${path} is a PASS holding ${list.length} finding(s)` });
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
      console.log(`check:render-audit: ${findings.length} finding(s)`);
    }
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`check:render-audit: ${error.message}`);
    process.exitCode = 2;
  }
}
