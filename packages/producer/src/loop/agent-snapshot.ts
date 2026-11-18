/**
 * The before/after snapshot of an agent step of an agent's own loop (foundry-build-0048 U9a fix round 4, blind2 B1).
 *
 * A code step's writes are what its verb changed between two snapshots (cli.ts). An agent step's were only what the
 * agent reported (`--wrote`), so a write it left out was never judged. Now the runner snapshots the consumer's record
 * trees (`clossys/` and `.clossys/`, by content: sha256 and link count of every regular file, the target of every
 * symlink, the mode of anything else) right before it hands the step to the agent, keeps that snapshot in the run
 * state while the run waits on the agent, and diffs it against the tree when the step answers:
 *
 * - a file the step removed is refused, except the run slot's own `.clossys/checks/<agent>/<slot-id>/cascade.json` when
 *   the step is Producer's standard pick step (bound by `agentStepBinding`) and its pin record is in the after-snapshot
 *   (`clossys pin` clears the re-verdict the new pin replaces; planner decision, U9a fix round 4);
 * - a file the step changed or added that it did not report is refused, except the run slot's own `ledger.json` when
 *   the change is a pure append of events the step's own verb produces (`ledgerAppendIssue`);
 * - every reported file then goes through the write allowlist (runner.ts undeclaredWrites), with the snapshot so a
 *   queue entry or candidate that was there before the step is refused (create-only).
 *
 * The run's own state file, its lock and its temp file are the only paths left out: the runner writes them itself.
 * A run waiting on an agent step whose snapshot is missing or does not hash to its digest stops (fail closed).
 */
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { sha256Hex } from "../records/hash.js";
import { LEDGER_FILE, LEDGER_SCHEMA, eventIssues } from "../records/ledger.js";
import { jsonBytes } from "../records/slot-model/layout.js";
import type { DeciderVerb, LoopStep, LoopVersion } from "../records/types.js";
import { isStandardAgentStep } from "./agent-loops.js";
import { isLoopAgent } from "./agent-loops-ia.js";

/** Root-relative posix path of every file under `clossys/` and `.clossys/` → what it is (`file:<sha256>:<links>`, `link:<target>`, `other:<mode>`). */
export type TreeFiles = Record<string, string>;
/** The snapshot an agent step's run state keeps while it waits on the agent. */
export interface AgentSnapshot { readonly step: string; readonly files: TreeFiles; readonly digest: string }

/** The trees an agent step's snapshot covers: every Producer record, queue, ledger, check and run lives under them. */
export const SNAPSHOT_TREES = ["clossys", ".clossys"] as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The snapshot of `clossys/` and `.clossys/` under `root`, leaving out only run `runId`'s own state, lock and temp files. */
export function treeSnapshot(root: string, runId: string): TreeFiles {
  const own = new Set([`.clossys/runs/loops/${runId}.json`, `.clossys/runs/loops/${runId}.lock`]);
  const ownTemp = new RegExp(`^\\.clossys/runs/loops/${escapeRegex(runId)}\\.json\\.\\d+\\.tmp$`);
  const out: TreeFiles = {};
  const mark = (path: string, at: string): void => {
    let stat;
    try { stat = lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    if (stat.isSymbolicLink()) out[at] = `link:${readlinkSync(path)}`;
    else if (stat.isDirectory()) walk(path, at);
    else if (stat.isFile()) out[at] = `file:${sha256Hex(readFileSync(path))}:${stat.nlink}`;
    else out[at] = `other:${stat.mode}`;
  };
  const walk = (dir: string, rel: string): void => {
    let names: string[];
    try { names = readdirSync(dir).sort(); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const name of names) {
      const at = `${rel}/${name}`;
      if (own.has(at) || ownTemp.test(at)) continue;
      mark(join(dir, name), at);
    }
  };
  for (const tree of SNAPSHOT_TREES) mark(join(root, tree), tree);
  return out;
}

/** The digest a kept snapshot is checked against on resume (sorted entries, so key order never matters). */
export const snapshotDigest = (files: TreeFiles): string =>
  sha256Hex(JSON.stringify(Object.keys(files).sort().map(key => [key, files[key]])));

export const keepSnapshot = (step: string, files: TreeFiles): AgentSnapshot => ({ step, files, digest: snapshotDigest(files) });

/** A kept snapshot for this step that is whole and hashes to its digest; undefined when it is missing or corrupt. */
export function keptSnapshot(saved: unknown, step: string): TreeFiles | undefined {
  if (!isObject(saved) || saved.step !== step || typeof saved.digest !== "string" || !isObject(saved.files)) return undefined;
  const files = saved.files;
  if (!Object.values(files).every(value => typeof value === "string" && /^(?:file:[0-9a-f]{64}:\d+|link:.*|other:\d+)$/s.test(value))) return undefined;
  if (!Object.keys(files).every(key => SNAPSHOT_TREES.some(tree => key === tree || key.startsWith(`${tree}/`)))) return undefined;
  return snapshotDigest(files as TreeFiles) === saved.digest ? files as TreeFiles : undefined;
}

/** A root-relative snapshot key as the ledger and the allowlist name it: `clossys/agents/` dropped. */
export const displayPath = (key: string): string => key.startsWith("clossys/agents/") ? key.slice("clossys/agents/".length) : key;

/**
 * The ledger events an agent step's own verb produces, by decider verb (planner decision, U9a fix round 4): a pick
 * pins (`clossys pin`/`clossys pick`: a pin or pick event); a create submits (`clossys next --submit`: a submit event).
 * refine-brief (`clossys brief --tighten`) writes only slot.json; no other verb appends to a slot ledger.
 */
export const LEDGER_EVENT_VERBS: Readonly<Partial<Record<DeciderVerb, readonly string[]>>> = {
  pick: ["pin", "pick"],
  "create-candidates": ["submit"],
};

/** The sha256 a `file:` snapshot mark records; undefined for anything else. */
const markSha = (mark: string | undefined): string | undefined => /^file:([0-9a-f]{64}):\d+$/.exec(mark ?? "")?.[1];

/**
 * Why a change to the run slot's own `ledger.json` is not a pure append the step may make; undefined when it is:
 * the file is a regular file with one link, written as the ledger writer writes it (`{schema, events}` in its bytes);
 * the ledger before the step (its sha256 in `beforeMark`; none when it was absent) is exactly its first N events, so
 * no prior event changed; and every appended event is a valid slot event of a verb the step's own decider verb
 * produces (`LEDGER_EVENT_VERBS`), made by this agent and naming no other slot.
 */
export function ledgerAppendIssue(root: string, key: string, beforeMark: string | undefined, afterMark: string | undefined, step: Pick<LoopStep, "id" | "decider">, agent: string, slotId: string): string | undefined {
  const shown = displayPath(key);
  const verb = step.decider.by === "agent" ? step.decider.verb : undefined;
  const allowed = verb === undefined ? [] : LEDGER_EVENT_VERBS[verb] ?? [];
  if (!allowed.length) return `${shown}: step ${step.id} (${verb ?? step.decider.by}) appends no ledger events`;
  if (!/^file:[0-9a-f]{64}:1$/.test(afterMark ?? "")) return `${shown}: is not a regular file with one link`;
  let bytes: string;
  try { bytes = readFileSync(join(root, ...key.split("/")), "utf8"); } catch { return `${shown}: cannot be read`; }
  if (sha256Hex(bytes) !== markSha(afterMark)) return `${shown}: changed while it was judged`;
  let doc: unknown;
  try { doc = JSON.parse(bytes); } catch { return `${shown}: is not JSON`; }
  if (!isObject(doc) || doc.schema !== LEDGER_SCHEMA || !Array.isArray(doc.events) || Object.keys(doc).length !== 2) return `${shown}: is not a ${LEDGER_SCHEMA} {schema, events} document`;
  const events = doc.events as unknown[];
  const as = (list: readonly unknown[]) => jsonBytes({ schema: LEDGER_SCHEMA, events: list });
  if (as(events) !== bytes) return `${shown}: is not in the ledger writer's bytes`;
  let kept: number | undefined;
  if (beforeMark === undefined) kept = 0;
  else {
    const was = markSha(beforeMark);
    if (was !== undefined) for (let n = events.length - 1; n >= 0; n--) if (sha256Hex(as(events.slice(0, n))) === was) { kept = n; break; }
  }
  if (kept === undefined) return `${shown}: the ledger before step ${step.id} is not a prefix of it (a prior event was changed or removed)`;
  const appended = events.slice(kept);
  if (!appended.length) return `${shown}: changed with no event appended`;
  const agentBy = (by: unknown) => typeof by === "string" && (by === `agent:${agent}` || by.startsWith(`agent:${agent}.`));
  for (const [index, event] of appended.entries()) {
    const at = `${shown} event ${kept + index}`;
    const issues = eventIssues(event, "slot");
    if (issues.length) return `${at}: ${issues.join("; ")}`;
    const row = event as Record<string, unknown>;
    if (!allowed.includes(String(row.op)) || !allowed.includes(String(row.verb))) return `${at}: op ${String(row.op)} verb ${String(row.verb)} is not what step ${step.id} (${verb}) produces (${allowed.join(", ")})`;
    if (!agentBy(row.by)) return `${at}: is by ${String(row.by)}, not agent:${agent}`;
    if (row.decidedBy !== undefined && row.decidedBy !== `agent:${agent}`) return `${at}: is decided by ${String(row.decidedBy)}, not agent:${agent}`;
    if (row.slot !== undefined && row.slot !== slotId && row.slot !== `${agent}/${slotId}`) return `${at}: names slot ${String(row.slot)}, not ${agent}/${slotId}`;
  }
  return undefined;
}

/** The run slot's own ledger, as a snapshot key. */
export const ownLedgerKey = (subject: { agent: string; slotId: string }): string => `clossys/agents/${subject.agent}/${subject.slotId}/${LEDGER_FILE}`;

/** The run slot's own cascade re-verdict and pin record, as snapshot keys. */
export const ownCascadeKey = (subject: { agent: string; slotId: string }): string => `.clossys/checks/${subject.agent}/${subject.slotId}/cascade.json`;
export const ownPinKey = (subject: { agent: string; slotId: string }): string => `clossys/agents/${subject.agent}/${subject.slotId}/pin.json`;

/**
 * Whether a removal of the run slot's own cascade re-verdict is the pick the standard makes: the step is Producer's
 * standard pick step of the loop the consumer runs now (same id, decider and cli: `isStandardAgentStep`), and the pin
 * record it writes for that slot is in the after-snapshot, changed from before. Anything else that removes it is refused.
 */
export function pickClearsCascade(before: TreeFiles, after: TreeFiles, step: Pick<LoopStep, "id" | "decider" | "cli">, agent: string, subject: { agent: string; slotId: string }, standard: LoopVersion | undefined): boolean {
  if (subject.agent !== agent || !isLoopAgent(agent) || step.decider.by !== "agent" || step.decider.verb !== "pick") return false;
  if (!isStandardAgentStep(standard, step, agent)) return false;
  const pin = ownPinKey(subject);
  return after[pin] !== undefined && after[pin]!.startsWith("file:") && after[pin] !== before[pin];
}

/** A reported `--wrote` file as a snapshot key (root-relative posix), from its resolved absolute path. */
export const snapshotKey = (root: string, absolute: string): string => relative(root, absolute).split(sep).join("/");

export interface SnapshotJudgement {
  /** Why the step's changes are refused (empty when they are not). */
  readonly issues: string[];
  /** Snapshot keys of the run slot's ledger when its change was accepted as a pure append (judged here, not by the allowlist). */
  readonly appended: string[];
}

/**
 * The diff of an agent step: every removed file (the standard pick's own cascade re-verdict aside, `pickClearsCascade`),
 * every changed or added file the step did not report (the own slot's ledger aside, judged by `ledgerAppendIssue`), and
 * every changed symlink or non-regular file. `standard` is the Producer loop the consumer runs now for the run's loop.
 */
export function judgeSnapshot(root: string, before: TreeFiles, after: TreeFiles, reported: ReadonlySet<string>, step: Pick<LoopStep, "id" | "decider" | "cli">, agent: string, subject: { agent: string; slotId: string } | undefined, standard?: LoopVersion): SnapshotJudgement {
  const issues: string[] = [], appended: string[] = [];
  const ledger = subject && subject.agent === agent ? ownLedgerKey(subject) : undefined;
  const cascade = subject && subject.agent === agent ? ownCascadeKey(subject) : undefined;
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const was = before[key], now = after[key];
    if (was === now) continue;
    const shown = displayPath(key);
    if (now === undefined) {
      if (key === cascade && pickClearsCascade(before, after, step, agent, subject!, standard)) continue;
      issues.push(`removed ${shown}`); continue;
    }
    if (!now.startsWith("file:")) { issues.push(`${was === undefined ? "added" : "changed"} ${shown}, which is ${now.startsWith("link:") ? "a symlink" : "not a regular file"}`); continue; }
    if (key === ledger) {
      const why = ledgerAppendIssue(root, key, was, now, step, agent, subject!.slotId);
      if (why !== undefined) issues.push(`changed ${why}`); else appended.push(key);
      continue;
    }
    if (!reported.has(key)) issues.push(`${was === undefined ? "added" : "changed"} ${shown} without reporting it (--wrote)`);
  }
  return { issues, appended };
}
