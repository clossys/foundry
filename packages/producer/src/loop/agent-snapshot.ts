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
 * - the engine's event log and index (`.clossys/events.jsonl`, `.clossys/index.json`) change as a consequence of the
 *   step's verbs, never by the step's own hand: the log only by a pure append that verifies on the chain and whose new
 *   events are the step agent's own, of a kind its verb makes, naming only files this step changed by their bytes (or
 *   the runner's events for the run's own state file), the index only to a rebuild of the log (`engineLogIssue`,
 *   `engineIndexIssue`; engine.md "The one writer"). A removal of either is refused.
 *
 * - a queue entry the step's own decide verbs write more than once (`clossys request <id> --check`, then `--decide`,
 *   the order the agent's `<agent>.slot` skill gives; foundry-build-0048 LOOP-STEPS): the snapshot also keeps the bytes
 *   of each queue entry the step names by its exact path in `writes` (`stepEntryTexts`), so an earlier event naming it
 *   is judged against the states the entry passed through on the way from those bytes to its bytes now
 *   (`entryStepShas`); a state no prefix of the after-events and mix of before and after values gives is refused.
 *
 * The run's own state file, its lock and its temp file are left out: the runner writes them itself. So is the engine
 * lock's own state (ENGINE_LOCK_STATE): the engine's lock protocol writes it, and it is never a record.
 * A run waiting on an agent step whose snapshot is missing or does not hash to its digest stops (fail closed).
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { EVENTS_FILE, INDEX_FILE, LOCK_FILE, verifyChain } from "../engine/chain.js";
import { indexAgreement } from "../engine/derived.js";
import { sha256Hex } from "../records/hash.js";
import { LEDGER_FILE, LEDGER_SCHEMA, eventIssues } from "../records/ledger.js";
import { jsonBytes } from "../records/slot-model/layout.js";
import type { DeciderVerb, LoopStep, LoopVersion } from "../records/types.js";
import { isStandardAgentStep } from "./agent-loops.js";
import { isLoopAgent } from "./agent-loops-ia.js";
import { RUN_CLI } from "./route.js";

/** Root-relative posix path of every file under `clossys/` and `.clossys/` → what it is (`file:<sha256>:<links>`, `link:<target>`, `other:<mode>`). */
export type TreeFiles = Record<string, string>;
/** Snapshot key → the file's bytes (utf8) before the step: only the queue entries the step names exactly (`stepEntryTexts`). */
export type TreeTexts = Record<string, string>;
/**
 * The snapshot an agent step's run state keeps while it waits on the agent. `texts` (LOOP-STEPS) are the before bytes of
 * the queue entries the step names exactly; each is bound to `files` by its sha256 (`keptTexts`), so the digest covers it.
 */
export interface AgentSnapshot { readonly step: string; readonly files: TreeFiles; readonly digest: string; readonly texts?: TreeTexts }

/** The trees an agent step's snapshot covers: every Producer record, queue, ledger, check and run lives under them. */
export const SNAPSHOT_TREES = ["clossys", ".clossys"] as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * The engine lock and the siblings its recovery makes (engine/lock.ts: `.recover-<instance>` markers, nested for a
 * dead recoverer, and `.new-<token>-<id>` staging files): the engine's own coordination state, never a record. A
 * writer that dies mid-recovery leaves one behind, and it is no step's write.
 */
const ENGINE_LOCK_STATE = new RegExp(`^${escapeRegex(LOCK_FILE)}(?:\\.recover-[0-9a-f]{32})*(?:\\.new-[0-9a-f-]{36}-[0-9a-f-]{36})?$`);

/** The snapshot of `clossys/` and `.clossys/` under `root`, leaving out only run `runId`'s own state, lock and temp files and the engine lock's state. */
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
      if (own.has(at) || ownTemp.test(at) || ENGINE_LOCK_STATE.test(at)) continue;
      mark(join(dir, name), at);
    }
  };
  for (const tree of SNAPSHOT_TREES) mark(join(root, tree), tree);
  return out;
}

/** The digest a kept snapshot is checked against on resume (sorted entries, so key order never matters). */
export const snapshotDigest = (files: TreeFiles): string =>
  sha256Hex(JSON.stringify(Object.keys(files).sort().map(key => [key, files[key]])));

export const keepSnapshot = (step: string, files: TreeFiles, texts?: TreeTexts): AgentSnapshot =>
  ({ step, files, digest: snapshotDigest(files), ...(texts && Object.keys(texts).length ? { texts } : {}) });

/** A kept snapshot for this step that is whole and hashes to its digest; undefined when it is missing or corrupt. */
export function keptSnapshot(saved: unknown, step: string): TreeFiles | undefined {
  if (!isObject(saved) || saved.step !== step || typeof saved.digest !== "string" || !isObject(saved.files)) return undefined;
  const files = saved.files;
  if (!Object.values(files).every(value => typeof value === "string" && /^(?:file:[0-9a-f]{64}:\d+|link:.*|other:\d+)$/s.test(value))) return undefined;
  if (!Object.keys(files).every(key => SNAPSHOT_TREES.some(tree => key === tree || key.startsWith(`${tree}/`)))) return undefined;
  return snapshotDigest(files as TreeFiles) === saved.digest ? files as TreeFiles : undefined;
}

/**
 * The kept before bytes of a whole snapshot (`keptSnapshot`'s `files`): none kept is `{}`; undefined when one is not a
 * string, names a file the snapshot does not hold, or does not hash to that file's mark (corrupt: the run stops).
 */
export function keptTexts(saved: unknown, files: TreeFiles): TreeTexts | undefined {
  if (!isObject(saved) || saved.texts === undefined) return {};
  if (!isObject(saved.texts)) return undefined;
  const texts = saved.texts;
  for (const [key, text] of Object.entries(texts)) {
    if (typeof text !== "string" || !Object.hasOwn(files, key) || markSha(files[key]) !== sha256Hex(Buffer.from(text, "utf8"))) return undefined;
  }
  return texts as TreeTexts;
}

/** A queue entry as a snapshot key (`clossys/agents/producer/queue.<queue>/entries/<id>.json`). */
const QUEUE_ENTRY_KEY = /^clossys\/agents\/producer\/queue\.[a-z]+\/entries\/[^/*]+\.json$/;

/**
 * The bytes before the step of each queue entry in `keys` (the step's exact `writes`, as snapshot keys) that the
 * snapshot `before` holds as a regular file whose bytes still hash to its mark; any other key is left out, so an
 * earlier event naming it is judged by the after bytes alone (fail closed).
 */
export function stepEntryTexts(root: string, before: TreeFiles, keys: readonly string[]): TreeTexts {
  const out: TreeTexts = {};
  for (const key of keys) {
    if (!QUEUE_ENTRY_KEY.test(key) || markSha(before[key]) === undefined) continue;
    let bytes: Buffer;
    try { bytes = readFileSync(join(root, ...key.split("/"))); } catch { continue; }
    if (sha256Hex(bytes) === markSha(before[key])) out[key] = bytes.toString("utf8");
  }
  return out;
}

/** The most non-event keys an entry's states may differ in before and after a step (2^8 mixes): more is no state. */
const ENTRY_STEP_KEYS = 8;
/** The most writes in a step an entry's states are judged over (events appended between before and after). */
const ENTRY_STEP_EVENTS = 8;

/**
 * The sha256 of every state a queue entry passes through on its way from `before` to `after` in one step, in the
 * request writer's bytes (`JSON.stringify(entry, null, 2)` and a newline, records/request.ts writeRequest): its events
 * are the after-events cut after any event the step appended but the last, and each other key holds its before or
 * its after value (or is absent where that side lacks it), in the before key order with keys new in after appended
 * (a verb spreads the entry it read, then sets what it adds), or in the after order with keys after dropped appended.
 * Empty unless both are entries (objects with an events list) whose before-events are a prefix of the after-events,
 * and when they differ in more than ENTRY_STEP_KEYS keys or ENTRY_STEP_EVENTS events: a state is only ever a mix of
 * what the entry held before the step and what it holds after, never a value neither has.
 */
export function entryStepShas(before: string, after: string): Set<string> {
  const out = new Set<string>();
  let was: unknown, now: unknown;
  try { was = JSON.parse(before); now = JSON.parse(after); } catch { return out; }
  if (!isObject(was) || !isObject(now) || !Array.isArray(was.events) || !Array.isArray(now.events)) return out;
  const wasEvents = was.events, nowEvents = now.events;
  if (wasEvents.length >= nowEvents.length || nowEvents.length - wasEvents.length > ENTRY_STEP_EVENTS) return out;
  if (!wasEvents.every((event, index) => JSON.stringify(event) === JSON.stringify(nowEvents[index]))) return out;
  const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(key => key !== "events");
  const differ = keys.filter(key => !Object.hasOwn(was as object, key) || !Object.hasOwn(now as object, key) || JSON.stringify((was as Record<string, unknown>)[key]) !== JSON.stringify((now as Record<string, unknown>)[key]));
  if (differ.length > ENTRY_STEP_KEYS) return out;
  const orders = [
    [...Object.keys(was), ...Object.keys(now).filter(key => !Object.hasOwn(was as object, key))],
    [...Object.keys(now), ...Object.keys(was).filter(key => !Object.hasOwn(now as object, key))],
  ];
  for (let cut = wasEvents.length + 1; cut < nowEvents.length; cut++) {
    const events = nowEvents.slice(0, cut);
    for (let mask = 0; mask < 1 << differ.length; mask++) {
      const values = new Map<string, unknown>();
      for (const key of keys) {
        const index = differ.indexOf(key);
        const side = index < 0 || mask & (1 << index) ? now as Record<string, unknown> : was as Record<string, unknown>;
        if (Object.hasOwn(side, key)) values.set(key, side[key]);
      }
      values.set("events", events);
      for (const order of orders) {
        const state: Record<string, unknown> = {};
        for (const key of order) if (values.has(key)) state[key] = values.get(key);
        out.add(sha256Hex(Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8")));
      }
    }
  }
  return out;
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

/** The run's own state file as a snapshot key: left out of the snapshot, and the one input a run event may name unchanged. */
export const ownStateKey = (runId: string): string => `.clossys/runs/loops/${runId}.json`;

/**
 * Who an engine event of an agent step's verb may name as its actor: `seat` is the step's agent as the record writers
 * name it (`agent:<agent>`, `agent:<agent>.<seat>`, or the bare seat `<agent>` a request event carries); `verb` also
 * lets through the Producer code that verb runs for the agent, which a record names when no seat decided it (a pin map's
 * `code:clossys pin`, a request routed by the `producer` seat). No owner, planner or other agent is ever one.
 */
export type AgentEventActor = "seat" | "verb";

/**
 * The engine event kinds an agent step's own verb produces, by decider verb, with the actors each may name
 * (foundry-build-0048 ENG-0 fix round 1): a pick pins (`clossys pin`/`clossys pick`: the slot ledger's pin or pick
 * event, and the pin document it writes); a create submits (`clossys next --submit`: the slot ledger's submit event)
 * and may raise the upstream request its skill tells it to (`clossys request --kind change ...`: the new request record,
 * which the runner then judges as exactly the verb's own entry, loop/runner.ts stepRaises; foundry-build-0048
 * LOOP-STEPS); a decide files or answers a request (`clossys request`: the request record). refine-brief and check emit none.
 */
export const AGENT_STEP_EVENTS: Readonly<Partial<Record<DeciderVerb, Readonly<Record<string, AgentEventActor>>>>> = {
  pick: { "slot.pin": "seat", "slot.pick": "seat", "pin.write": "verb", "pin-map.write": "verb" },
  "create-candidates": { "slot.submit": "seat", "request.create": "verb" },
  decide: { "request.create": "verb", "request.write": "verb" },
};

/** Whether `actor` is the step's agent `agent` (`seat`), or also the Producer code its verb runs (`verb`). */
export function agentEventActor(actor: string, agent: string, allowed: AgentEventActor): boolean {
  if (actor === `agent:${agent}` || actor.startsWith(`agent:${agent}.`) || actor === agent) return true;
  return allowed === "verb" && (actor === "producer" || /^code:clossys [a-z][a-z-]*$/.test(actor));
}

/** The actor and kind of the run events the runner appends for its own state while a step waits (runner.ts logRun). */
export const runEventActor = (): string => `code:${RUN_CLI}`;
export const RUN_EVENT_KIND = "run.state";

/** The sha256 of a snapshot file's bytes before the step (its mark), now (its after mark), or of the run's state file. */
type ShaOf = (path: string) => string | null | undefined;

/**
 * Why a change to the engine's event log is not the append the step's verbs make; undefined when it is: the log is a
 * regular file with one link that verifies on its chain; the log before the step (its sha256 in `beforeMark`; none when
 * it was absent) is a whole-line prefix of it, so no prior event changed or went; at least one event was appended; and
 * every appended event is one of two shapes (foundry-build-0048 ENG-0 fix round 1, blind A B3):
 *
 * - an event of the step's own verbs: its kind is one the step's decider verb produces and its actor the step's agent
 *   (or, for a kind the verb's Producer code writes, that code), never an owner, a planner or another agent
 *   (`AGENT_STEP_EVENTS`), its subject is the agent's own (`<agent>/...`, or a request the verb files), and it names at
 *   least one input, each a file this step changed (`changed`)
 *   whose sha256 is the file's bytes: the last event naming a file carries its bytes after the step, an earlier one the
 *   bytes it had then (for a ledger, a prefix of the after-ledger in the ledger writer's bytes; for a queue entry the
 *   step names exactly, with its before bytes in `texts`, a state it passed through, `entryStepShas`; any other file
 *   is written once per step, so every event naming it carries its after bytes);
 * - a run event (`runId` given): actor `code:clossys run`, kind run.state, subject `loop:<loop>/<runId>`, one input,
 *   the run's own state file; the last carries the state file's bytes now.
 *
 * An event naming a file the step left as it was, an owner's or other actor's event, a kind the verb does not make, or
 * an input hash that is not the file's bytes is a claim no write of this step backs, and is refused.
 */
export function engineLogIssue(root: string, beforeMark: string | undefined, afterMark: string | undefined, changed: ReadonlySet<string>, step: Pick<LoopStep, "id" | "decider">, agent: string, after: TreeFiles, runId?: string, texts: Readonly<TreeTexts> = {}): string | undefined {
  const shown = EVENTS_FILE;
  const stepId = step.id;
  if (!/^file:[0-9a-f]{64}:1$/.test(afterMark ?? "")) return `${shown}: is not a regular file with one link`;
  let bytes: Buffer;
  try { bytes = readFileSync(join(root, ...EVENTS_FILE.split("/"))); } catch { return `${shown}: cannot be read`; }
  if (sha256Hex(bytes) !== markSha(afterMark)) return `${shown}: changed while it was judged`;
  const text = bytes.toString("utf8");
  const torn = text !== "" && !text.endsWith("\n");
  const lines = text === "" ? [] : (torn ? text : text.slice(0, -1)).split("\n");
  const report = verifyChain(root, { lines, torn });
  if (!report.ok) return `${shown}: does not verify (${report.issues[0]!.message})`;
  let kept: number | undefined;
  if (beforeMark === undefined) kept = 0;
  else {
    const was = markSha(beforeMark);
    const hash = createHash("sha256");
    if (was === hash.copy().digest("hex")) kept = 0;
    else for (const [index, line] of lines.entries()) {
      hash.update(`${line}\n`);
      if (hash.copy().digest("hex") === was) { kept = index + 1; break; }
    }
  }
  if (kept === undefined) return `${shown}: the log before step ${stepId} is not a prefix of it (an event was changed or removed)`;
  const appended = report.events.slice(kept);
  if (!appended.length) return `${shown}: changed with no event appended`;
  const own = runId === undefined ? undefined : ownStateKey(runId);
  const verb = step.decider.by === "agent" ? step.decider.verb : undefined;
  const events = (verb === undefined ? undefined : AGENT_STEP_EVENTS[verb]) ?? {};
  const kinds = Object.keys(events);
  const lastNaming = new Map<string, number>();
  for (const [index, event] of appended.entries()) for (const input of event.inputs) lastNaming.set(input.path, index);
  const afterSha: ShaOf = path => markSha(after[path]) ?? (after[path] === undefined ? null : undefined);
  const stateSha = (): string | null => { try { return sha256Hex(readFileSync(join(root, ...own!.split("/")))); } catch { return null; } };
  for (const [index, event] of appended.entries()) {
    const at = `${shown} event seq ${event.seq} (${event.kind} ${event.subject})`;
    const unbacked = event.inputs.find(input => !changed.has(input.path) && input.path !== own);
    if (unbacked) return `${at}: names ${unbacked.path}, which step ${stepId} did not change`;
    const run = own !== undefined && event.inputs.some(input => input.path === own);
    if (run) {
      if (event.actor !== runEventActor() || event.kind !== RUN_EVENT_KIND) return `${at}: names the run's own state file but is ${event.actor} ${event.kind}, not the runner's ${runEventActor()} ${RUN_EVENT_KIND}`;
      if (event.inputs.length !== 1 || !event.subject.startsWith("loop:") || !event.subject.endsWith(`/${runId!}`)) return `${at}: a run event names only the run's own state file, with subject loop:<loop>/${runId!}`;
      if (lastNaming.get(own) === index && event.inputs[0]!.sha256 !== stateSha()) return `${at}: its sha256 of ${own} is not the state file's bytes`;
      continue;
    }
    const allowed = Object.hasOwn(events, event.kind) ? events[event.kind] : undefined;
    if (!agentEventActor(event.actor, agent, allowed ?? "seat")) return `${at}: is by ${event.actor}, not the step's agent agent:${agent}${allowed === "verb" ? " or the Producer code its verb runs" : ""}`;
    if (allowed === undefined) return `${at}: kind ${event.kind} is not one step ${stepId} (${verb ?? step.decider.by}) produces (${kinds.join(", ") || "none"})`;
    if (event.subject !== agent && !event.subject.startsWith(`${agent}/`) && !(event.kind.startsWith("request.") && event.subject.startsWith("request:"))) return `${at}: names subject ${event.subject}, not one of agent ${agent}'s`;
    if (!event.inputs.length) return `${at}: names no input`;
    for (const input of event.inputs) {
      const final = lastNaming.get(input.path) === index;
      const now = afterSha(input.path);
      if (input.sha256 === now) continue;
      if (!final && input.path.endsWith(`/${LEDGER_FILE}`) && input.sha256 !== null && ledgerPrefixShas(root, input.path).has(input.sha256)) continue;
      if (!final && input.sha256 !== null && Object.hasOwn(texts, input.path) && entryStatesOf(root, input.path, texts[input.path]!, now).has(input.sha256)) continue;
      return `${at}: its sha256 of ${input.path} is not the file's bytes ${final ? "after the step" : "when it was written"}`;
    }
  }
  return undefined;
}

/** The states a queue entry passed through in the step (`entryStepShas`), from its kept before bytes to its bytes now (`nowSha`). */
function entryStatesOf(root: string, key: string, before: string, nowSha: string | null | undefined): Set<string> {
  let bytes: Buffer;
  try { bytes = readFileSync(join(root, ...key.split("/"))); } catch { return new Set(); }
  if (nowSha == null || sha256Hex(bytes) !== nowSha) return new Set();
  return entryStepShas(before, bytes.toString("utf8"));
}

/** The sha256 of every prefix of the ledger at `key` in the ledger writer's bytes (the ledger as each event left it). */
function ledgerPrefixShas(root: string, key: string): Set<string> {
  const out = new Set<string>();
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(join(root, ...key.split("/")), "utf8")); } catch { return out; }
  if (!isObject(doc) || !Array.isArray(doc.events)) return out;
  for (let n = 0; n <= doc.events.length; n++) out.add(sha256Hex(jsonBytes({ schema: doc.schema, events: doc.events.slice(0, n) })));
  return out;
}

/** Why the engine index after the step is not the rebuild of the log and the records; undefined when it is. */
export function engineIndexIssue(root: string, afterMark: string | undefined): string | undefined {
  if (!/^file:[0-9a-f]{64}:1$/.test(afterMark ?? "")) return `${INDEX_FILE}: is not a regular file with one link`;
  const agreement = indexAgreement(root);
  return agreement.agrees ? undefined : `${INDEX_FILE}: is not the rebuild of the log (${agreement.diffs[0] ?? "unreadable"})`;
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
 * every changed symlink or non-regular file. The engine's log and index are judged by `engineLogIssue` and
 * `engineIndexIssue`, never by `reported`. `standard` is the Producer loop the consumer runs now for the run's loop;
 * `runId` names the run whose own state file its run events may name; `texts` are the kept before bytes of the queue
 * entries the step names exactly (`stepEntryTexts`).
 */
export function judgeSnapshot(root: string, before: TreeFiles, after: TreeFiles, reported: ReadonlySet<string>, step: Pick<LoopStep, "id" | "decider" | "cli">, agent: string, subject: { agent: string; slotId: string } | undefined, standard?: LoopVersion, runId?: string, texts: Readonly<TreeTexts> = {}): SnapshotJudgement {
  const issues: string[] = [], appended: string[] = [];
  const ledger = subject && subject.agent === agent ? ownLedgerKey(subject) : undefined;
  const cascade = subject && subject.agent === agent ? ownCascadeKey(subject) : undefined;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changed = new Set(keys.filter(key => before[key] !== after[key] && key !== EVENTS_FILE && key !== INDEX_FILE));
  for (const key of keys) {
    const was = before[key], now = after[key];
    if (was === now) continue;
    const shown = displayPath(key);
    if (now === undefined) {
      if (key === cascade && pickClearsCascade(before, after, step, agent, subject!, standard)) continue;
      issues.push(`removed ${shown}`); continue;
    }
    if (!now.startsWith("file:")) { issues.push(`${was === undefined ? "added" : "changed"} ${shown}, which is ${now.startsWith("link:") ? "a symlink" : "not a regular file"}`); continue; }
    if (key === EVENTS_FILE) {
      const why = engineLogIssue(root, was, now, changed, step, agent, after, runId, texts);
      if (why !== undefined) issues.push(`changed ${why}`);
      continue;
    }
    if (key === INDEX_FILE) {
      const why = engineIndexIssue(root, now);
      if (why !== undefined) issues.push(`changed ${why}`);
      continue;
    }
    if (key === ledger) {
      const why = ledgerAppendIssue(root, key, was, now, step, agent, subject!.slotId);
      if (why !== undefined) issues.push(`changed ${why}`); else appended.push(key);
      continue;
    }
    if (!reported.has(key)) issues.push(`${was === undefined ? "added" : "changed"} ${shown} without reporting it (--wrote)`);
  }
  return { issues, appended };
}
