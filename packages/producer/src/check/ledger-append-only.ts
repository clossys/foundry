/**
 * `ledger.append-only` (system.md 2, 9.4): Producer queue and ledger entries are appended, never edited or deleted.
 *
 * Reads `git log` of `clossys/agents/producer/` (every commit, merges against each parent, no rename pairing) and the
 * working tree against HEAD. It fails when
 * - a ledger entry (`ledger.<loop>/entries/<id>.json`) was modified, retyped or deleted after it was first committed;
 * - a queue entry (`queue.<kind>/entries/<id>.json`) was deleted or retyped, or changed other than by appending
 *   (queue/append-only.ts: events and refs only grow at the end, status leaves `open` once, nothing else moves).
 * It also fails, rather than skipping, when the workspace is not inside a git repository or the clone is shallow,
 * because then the history cannot be read. Adding a new entry is always allowed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queueEntryChangeIssues } from "../queue/append-only.js";
import { runOf, type TargetCheckRun, type TargetFinding } from "./pins-resolve.js";

export const LEDGER_APPEND_ONLY = "ledger.append-only";

const PRODUCER = "clossys/agents/producer";
const QUEUE_FILE = /^clossys\/agents\/producer\/(queue\.(?:pick|approve|clarify|fix))\/entries\/([^/]+)\.json$/;
const LEDGER_FILE = /^clossys\/agents\/producer\/(ledger\.[^/]+)\/entries\/([^/]+)\.json$/;
const RAW = /^:(\d{6}) (\d{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])\d*\t(.+)$/;
const NULL_SHA = /^0+$/;

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", root, "-c", "core.quotePath=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
}

const tryGit = (root: string, args: readonly string[]): string | undefined => {
  try { return git(root, args); } catch { return undefined; }
};

interface Change { readonly where: string; readonly status: string; readonly oldMode: string; readonly newMode: string; readonly oldSha: string; readonly newSha: string; readonly path: string }

function parseRaw(text: string, where: (header: string) => string): Change[] {
  const out: Change[] = [];
  let header = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("commit ")) { header = line.slice("commit ".length).trim(); continue; }
    const match = RAW.exec(line);
    if (match) out.push({ where: where(header), oldMode: match[1]!, newMode: match[2]!, oldSha: match[3]!, newSha: match[4]!, status: match[5]!, path: match[6]! });
  }
  return out;
}

export function checkLedgerAppendOnly(root: string): TargetCheckRun {
  const findings: TargetFinding[] = [];
  const seen = new Set<string>();
  const push = (subject: string, detail: string): void => {
    const key = `${subject}\n${detail}`;
    if (!seen.has(key)) { seen.add(key); findings.push({ check: LEDGER_APPEND_ONLY, subject, detail }); }
  };

  const prefix = tryGit(root, ["rev-parse", "--show-prefix"]);
  if (prefix === undefined) {
    push(root, "not inside a git repository: ledger.append-only reads the git history of the queue and ledger entries and cannot pass without it");
    return runOf(LEDGER_APPEND_ONLY, findings);
  }
  if (tryGit(root, ["rev-parse", "--is-shallow-repository"])?.trim() === "true") {
    push(root, "the clone is shallow: earlier commits of the queue and ledger entries cannot be read (fetch the full history)");
    return runOf(LEDGER_APPEND_ONLY, findings);
  }
  if (tryGit(root, ["rev-parse", "--verify", "-q", "HEAD"]) === undefined) return runOf(LEDGER_APPEND_ONLY, findings); // nothing committed yet

  const top = prefix.trim();
  const blobs = new Map<string, string>();
  const blob = (sha: string): string => {
    let text = blobs.get(sha);
    if (text === undefined) { text = git(root, ["cat-file", "blob", sha]); blobs.set(sha, text); }
    return text;
  };
  const history = git(root, ["log", "--full-history", "--diff-merges=separate", "--no-renames", "--no-relative", "--raw", "--no-abbrev", "--format=commit %H", "--", PRODUCER]);
  const working = git(root, ["diff", "--no-renames", "--no-relative", "--raw", "--no-abbrev", "HEAD", "--", PRODUCER]);
  const changes = [
    ...parseRaw(history, header => `commit ${header.slice(0, 12)}`),
    ...parseRaw(working, () => "the working tree"),
  ];

  for (const change of changes) {
    if (!change.path.startsWith(top)) continue;
    const rel = change.path.slice(top.length);
    const queue = QUEUE_FILE.exec(rel), ledger = LEDGER_FILE.exec(rel);
    if (!queue && !ledger) continue;
    const subject = `producer/${(queue ?? ledger)![1]}#${(queue ?? ledger)![2]}`;
    if (change.status === "A") continue;
    if (change.status === "D") { push(subject, `${change.where} deletes the entry; entries are never deleted`); continue; }
    if (change.status !== "M" || change.oldMode !== change.newMode) { push(subject, `${change.where} changes the entry's file type (${change.status})`); continue; }
    if (ledger) { push(subject, `${change.where} edits a ledger entry; a ledger entry is written once`); continue; }
    let before: unknown, after: unknown;
    try { before = JSON.parse(blob(change.oldSha)); } catch { push(subject, `${change.where}: the earlier version is not JSON`); continue; }
    try {
      const text = NULL_SHA.test(change.newSha) ? readFileSync(join(root, rel), "utf8") : blob(change.newSha);
      after = JSON.parse(text);
    } catch { push(subject, `${change.where} leaves the entry unreadable or not JSON`); continue; }
    for (const issue of queueEntryChangeIssues(before, after)) push(subject, `${change.where}: ${issue}`);
  }
  return runOf(LEDGER_APPEND_ONLY, findings);
}
