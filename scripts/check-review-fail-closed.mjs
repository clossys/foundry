#!/usr/bin/env node
/**
 * check:review-fail-closed (rules R-REVIEW-FAIL-CLOSED and R-REVIEW-RUN-QUEUE, owner_agent reviewer): the
 * Reviewer's mechanical review fails closed, and its runs wait in one real queue.
 *
 * Findings, all mechanical:
 *
 *   missing-rule        packages/reviewer/skill/SKILL.md (under --root) does not state FAIL_CLOSED_TEXT or
 *                       QUEUE_TEXT verbatim, so the agent that owns the review no longer states the rule;
 *   no-verdict          a record given with --record has no verdict, or its last line (`line`) is not
 *                       `MECHANICAL:`, `RECEIPT:` or `MUTATION:` followed by that verdict: a missing verdict
 *                       is a FAIL, never a pass;
 *   pass-on-nothing     the record is a PASS that ran no command (a review's ran.commands is 0, a receipt's
 *                       commands list is empty);
 *   pass-on-missing     the record is a PASS although a command exited 127 (a missing install or tool);
 *   superseded-live     a queue file given with --queue holds queued or running runs of one unit at two
 *                       heads: the older head was not cancelled;
 *   over-capacity       more heavy runs are running than the --capacity heavy slots;
 *   gave-up             a queue entry is in a state other than queued, running, done or cancelled: a wait
 *                       never gives up.
 *
 * With neither --record nor --queue it checks the skill only. Records are the JSON of `clossys review
 * --record`, `clossys review --mutation --record` and a receipt's receipt.json; the queue is the run queue's
 * queue.json (packages/producer/src/review/queue.ts, whose queueFindings this mirrors).
 *
 *   node scripts/check-review-fail-closed.mjs [--root DIR] [--record <file>]... [--queue <queue.json> --capacity <n>] [--json]
 *
 * Exit 0 when nothing is found, 1 on a finding, 2 on a usage or read error. Plain node: no build.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL = "packages/reviewer/skill/SKILL.md";
export const FAIL_CLOSED_TEXT = "A mechanical review that ran no command, met a missing install (exit 127) or printed no verdict is FAIL, never PASS; a red test that also fails alone at the merge base is base-red, not new red.";
export const QUEUE_TEXT = "Every mechanical run waits in the one run queue, installs for active executors first and then by critical path; a wait never gives up, and a newer head cancels the runs of its unit at the older head.";
const VERDICT_LINE = /^(?:MECHANICAL|RECEIPT|MUTATION): (PASS|FAIL) \S+/;
const LIVE = new Set(["queued", "running"]);
const STATES = new Set(["queued", "running", "done", "cancelled"]);

class UsageError extends Error {}

export function parseArgs(argv) {
  const out = { root: undefined, records: [], queue: undefined, capacity: undefined, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = () => { const next = argv[++index]; if (next === undefined || next.startsWith("--")) throw new UsageError(`${arg} needs a value`); return next; };
    if (arg === "--root") out.root = value();
    else if (arg === "--record") out.records.push(value());
    else if (arg === "--queue") out.queue = value();
    else if (arg === "--capacity") out.capacity = value();
    else if (arg === "--json") out.json = true;
    else throw new UsageError(`unexpected argument ${arg}`);
  }
  if ((out.queue === undefined) !== (out.capacity === undefined)) throw new UsageError("--queue and --capacity go together: a queue is judged against the machine's heavy slots");
  if (out.capacity !== undefined) {
    const slots = Number(out.capacity);
    if (!Number.isInteger(slots) || slots < 1) throw new UsageError("--capacity must be a whole number of heavy slots, at least 1");
    out.capacity = slots;
  }
  return out;
}

/** The skill findings: the Reviewer skill states both rules verbatim. */
export function skillFindings(root) {
  const path = join(root, SKILL);
  if (!existsSync(path)) return [{ rule: "missing-rule", path: SKILL, message: `${SKILL} does not exist` }];
  const text = readFileSync(path, "utf8");
  return [FAIL_CLOSED_TEXT, QUEUE_TEXT].filter(rule => !text.includes(rule)).map(rule => ({ rule: "missing-rule", path: SKILL, message: `${SKILL} does not state the rule: ${rule}` }));
}

/** A record's verdict and what it ran, or null when it has no well-formed verdict. */
function verdictOf(record) {
  if (!record || typeof record !== "object") return null;
  const verdict = record.verdict;
  if (verdict !== "PASS" && verdict !== "FAIL") return null;
  const match = typeof record.line === "string" ? VERDICT_LINE.exec(record.line) : null;
  if (!match || match[1] !== verdict) return null;
  return verdict;
}

/** The record findings: a PASS has a verdict line that says so, ran at least one command and met no 127. */
export function recordFindings(record, path = "record") {
  const verdict = verdictOf(record);
  if (!verdict) return [{ rule: "no-verdict", path, message: `${path} has no verdict line agreeing with its verdict: a missing verdict is FAIL` }];
  if (verdict !== "PASS") return [];
  const findings = [];
  const commands = Array.isArray(record.commands) ? record.commands : [];
  const ran = record.ran && typeof record.ran === "object" ? record.ran : undefined;
  const count = ran && Number.isInteger(ran.commands) ? ran.commands : commands.length;
  if (count === 0) findings.push({ rule: "pass-on-nothing", path, message: `${path} is a PASS that ran no command: nothing checked is never a pass` });
  const missing = [...(Array.isArray(ran?.missing) ? ran.missing : []), ...commands.filter(entry => entry && entry.exit === 127).map(entry => String(entry.run ?? entry.id))];
  if (missing.length) findings.push({ rule: "pass-on-missing", path, message: `${path} is a PASS although ${missing.length} command(s) exited 127: ${missing.slice(0, 3).join("; ")}` });
  return findings;
}

/** The queue findings (packages/producer/src/review/queue.ts queueFindings). */
export function queueFindings(queue, capacity, path = "queue") {
  if (!queue || typeof queue !== "object" || queue.schema !== "clossys.run-queue/1" || !Array.isArray(queue.entries)) return [{ rule: "gave-up", path, message: `${path} is not a clossys.run-queue/1 document` }];
  const findings = [];
  const heads = new Map();
  for (const entry of queue.entries.filter(item => LIVE.has(item?.state))) heads.set(entry.unit, new Set([...(heads.get(entry.unit) ?? []), entry.head]));
  for (const [unit, set] of heads) if (set.size > 1) findings.push({ rule: "superseded-live", path, message: `${unit} has live runs at ${[...set].map(head => String(head).slice(0, 12)).join(" and ")}: the older head was not cancelled` });
  const running = queue.entries.filter(item => item?.state === "running" && item.heavy !== false).length;
  if (running > capacity) findings.push({ rule: "over-capacity", path, message: `${running} heavy runs running on ${capacity} slot(s)` });
  for (const entry of queue.entries) if (!STATES.has(entry?.state)) findings.push({ rule: "gave-up", path, message: `${entry?.id ?? "an entry"} is ${String(entry?.state)}: a queued run waits until it runs or is cancelled, never gives up` });
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
  if (args.queue !== undefined) findings.push(...queueFindings(readJson(args.queue), args.capacity, args.queue));
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  try {
    const findings = run(argv);
    if (argv.includes("--json")) console.log(JSON.stringify({ findings }, null, 2));
    else {
      for (const finding of findings) console.log(`${finding.rule}\t${finding.path}\t${finding.message}`);
      console.log(`check:review-fail-closed: ${findings.length} finding(s)`);
    }
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`check:review-fail-closed: ${error.message}`);
    process.exitCode = 2;
  }
}
