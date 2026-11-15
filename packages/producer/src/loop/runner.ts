/**
 * The loop runner behind `clossys run loop.<name>` (producer.md 10, flows.md 3-4).
 *
 * One step at a time, in the order of the version that runs (the consumer pin, else package v1; version.ts):
 *
 * - a step whose `when` does not match the slot is skipped and left out of the ledger;
 * - a code step runs through `hooks.code` (the CLI runs the verb); two are built in: `clossys check --route` routes the
 *   previous step's findings (route.ts) and `clossys check <dependants>` marks every `consumedBy` dependant
 *   `needs-refresh` when this run changed the slot's pin (flows.md F7 step 1);
 * - an agent step hands `hooks.agent` a packet (agent, verb, tier, skill, cli); the agent answers with its exit, the
 *   files it wrote and the model that served it, or `wait`;
 * - a human step raises a queue entry for the owner and the run waits. It resumes only from the entry: open keeps
 *   waiting, answered records the decision and goes on, withdrawn stops the run.
 *
 * A failed step follows its `onFail`: `retry` after a `queue.clarify` waits for the owner and runs the step again;
 * `retry` after a `queue.fix` goes back to the create step (one round more, at most `maxRounds`, then a
 * `queue.clarify` and a stop); `loop.<name>` raises the entry and stops the run so that loop takes it. Exit 2 stops.
 *
 * Run state is kept in `.clossys/runs/loops/<runId>.json`; resuming never runs a finished step again. Every run that
 * ends (done, stopped or pinned-ready) writes one ledger entry, `clossys/agents/producer/ledger.<loop>/entries/<runId>.json`.
 */
import { existsSync, mkdirSync, openSync, closeSync, writeSync, readFileSync, renameSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { checkPinsResolve, resolveAll } from "../check/pins-resolve.js";
import { answerQueueEntry } from "../queue/answer.js";
import { entryStamp, findQueueEntry, listQueueEntryFiles, readQueueEntry, slugOf } from "../queue/entry.js";
import { sha256Hex } from "../records/hash.js";
import { OWNER_BASES, buildPin, pinIssues, pinPath, writePinDoc } from "../records/pin.js";
import { mergeRefs, readPinFile } from "../records/pin-map.js";
import { isRecordSlot, resolveSlot, slotRecords, type Resolution } from "../records/resolve.js";
import { validateAgainst } from "../records/schema.js";
import { recordSchema, writeSlot } from "../records/slot.js";
import type { AgentId, Decider, DeciderVerb, Iso, LedgerEntry, LoopStep, LoopVersion, QueueEntry, Ref, Tier } from "../records/types.js";
import { RUN_BY, RUN_CLI, entryName, producerVersion, raiseEntry, routeFindings, type Finding, type Raise } from "./route.js";
import { dependantsOf, fillNames, nextFillSlot, readSubject, refOf, skillFor, slotCandidates, slotVars, stepArgv, whenMatches, type SlotSubject } from "./slots.js";
import {
  AGENT_PICK_VERB, CANDIDATE_NAME, ENTRY_NAME, EXIT_CHECKS, LOOP_SUBJECT, LOOP_TRIGGERS, OWNER_OF_SLOT, OWNER_PICK_RAISE, PUBLICATION_ID, RELEASE_READY, RUN_ID,
  SLOT_REF, TRIGGER_CODE, TRIGGER_KINDS, VERIFIED_CHECKS, ledgerOf, loopStem, type LoopName,
} from "./names.js";
import { loadLoopVersion, type LoadedLoop } from "./version.js";

export type Exit = 0 | 1 | 2;

/** What an agent step hands the agent (its skill decides; `clossys run` never calls a model). */
export interface AgentPacket {
  readonly runId: string;
  readonly step: string;
  readonly agent: AgentId;
  readonly verb: DeciderVerb;
  readonly tier: Tier;
  /** Package-relative skill path (system.md 14.1), when the agent package has it. */
  readonly skill?: string;
  readonly cli: string;
  readonly ref?: string;
  readonly round: number;
  /** The entry that triggered the run (`queue.fix#<id>`), for refine-brief to read the owner's words. */
  readonly from?: string;
}
export type AgentOutcome = { readonly exit: Exit; readonly model: string; readonly wrote?: readonly string[]; readonly cli?: string } | "wait";

export interface CodeCall {
  readonly runId: string;
  readonly step: string;
  readonly cli: string;
  readonly argv: readonly string[];
  readonly ref?: string;
  readonly publication?: string;
}
export interface CodeOutcome {
  readonly exit: Exit; readonly wrote?: readonly string[]; readonly findings?: readonly Finding[]; readonly detail?: string;
  /** The checks the verb actually ran; a step check not in it is recorded as not run, never as a pass (B7). Absent: all ran. */
  readonly ran?: readonly string[];
}

export interface RunHooks {
  agent(packet: AgentPacket): AgentOutcome | Promise<AgentOutcome>;
  code(call: CodeCall): CodeOutcome | Promise<CodeOutcome>;
}

type LedgerStep = LedgerEntry["steps"][number];
type Waiting =
  | { readonly step: string; readonly on: "agent" }
  | { readonly step: string; readonly on: "entry"; readonly entry: string; readonly then: "continue" | "retry" };

export interface RunState {
  schema: "clossys.loop-run/1";
  runId: string;
  loop: LoopName;
  version: { candidate: string; ref: string; sha256: string; source: "pin" | "package" };
  subject?: { agent: AgentId; slotId: string };
  publication?: string;
  trigger: { code: string; kind: string; ref?: Ref };
  from?: string;
  startedAt: Iso;
  status: "running" | "waiting" | "done" | "stopped" | "pinned-ready";
  cursor: number;
  round: number;
  startPin: string | null;
  /** The slot's pin.json bytes when the run started (null: none); an owner reject puts them back (B5). */
  startPinDoc?: string | null;
  steps: LedgerStep[];
  checks: Record<string, "pass" | "fail">;
  decisions: { entry: string; answer: string }[];
  refs: Ref[];
  raised: string[];
  vars: Record<string, string>;
  findings: Finding[];
  waiting?: Waiting;
  /** An owner entry about to be raised: saved before the raise, so a resume adopts the entry instead of raising it twice (B9). */
  pendingRaise?: { step: string; queue: string; at: Iso; then?: "retry" };
  /** Step checks the verb did not run (B7); named in the outcome. */
  notRun?: string[];
  outcome?: string;
  ledger?: string;
}

export interface StartInput {
  readonly loop: LoopName;
  readonly slot?: string;
  readonly from?: string;
  readonly publication?: string;
  readonly trigger?: string;
}

export interface RunResult {
  readonly exitCode: Exit;
  readonly state?: RunState;
  readonly message: string;
  /** The packet an agent step waits on, or the entry a human step waits on. */
  readonly packet?: AgentPacket;
  readonly entry?: string;
}

export interface RunOptions { readonly now?: () => Date }

const iso = (date: Date): Iso => date.toISOString().replace(/\.\d{3}Z$/, "Z");
export const runsDir = (root: string): string => join(root, ".clossys", "runs", "loops");
export const runStatePath = (root: string, runId: string): string => join(runsDir(root), `${runId}.json`);
const lockPath = (root: string, runId: string): string => join(runsDir(root), `${runId}.lock`);

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
};

/**
 * Takes the run's lock (B9): one process at a time starts or resumes a run. A lock whose process is gone is stale
 * and is taken over. Returns the release, or why the run is busy.
 */
function takeRunLock(root: string, runId: string): { release: () => void } | { busy: string } {
  const file = lockPath(root, runId);
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number;
    try { fd = openSync(file, "wx"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let holder = NaN;
      try { holder = Number(readFileSync(file, "utf8").trim()); } catch { /* gone meanwhile */ }
      if (Number.isInteger(holder) && holder > 0 && alive(holder)) return { busy: `run ${runId} is in use by process ${holder} (${relative(root, file)})` };
      try { unlinkSync(file); } catch { /* taken over meanwhile */ }
      continue;
    }
    try { writeSync(fd, `${process.pid}\n`); } finally { closeSync(fd); }
    return { release: () => { try { unlinkSync(file); } catch { /* already gone */ } } };
  }
  return { busy: `run ${runId}: its lock could not be taken` };
}

export const ledgerDir = (root: string, loop: LoopName): string => join(root, "clossys", "agents", "producer", ledgerOf(loop), "entries");
const agentsDir = (root: string): string => join(root, "clossys", "agents");

function saveState(root: string, state: RunState): void {
  const file = runStatePath(root, state.runId);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temp, file);
}

export function readRunState(root: string, runId: string): RunState | undefined {
  if (!RUN_ID.test(runId)) return undefined;
  const file = runStatePath(root, runId);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as RunState : undefined;
}

/** The runs still waiting, oldest first. */
export function waitingRuns(root: string): RunState[] {
  const dir = runsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => name.endsWith(".json")).sort()
    .map(name => JSON.parse(readFileSync(join(dir, name), "utf8")) as RunState)
    .filter(state => state.status === "waiting" || state.status === "running");
}

/** A path as the ledger names it: relative to `clossys/agents/` when inside it, else to the root. */
function ledgerPath(root: string, file: string): string {
  const absolute = file.startsWith(sep) ? file : join(agentsDir(root), file);
  const inAgents = relative(agentsDir(root), absolute);
  if (!inAgents.startsWith("..")) return inAgents.split(sep).join("/");
  return relative(root, absolute).split(sep).join("/");
}
function wroteOf(root: string, files: readonly string[] = []): LedgerStep["wrote"] {
  return files.map(file => {
    const rel = ledgerPath(root, file);
    const absolute = rel.startsWith(".clossys") ? join(root, rel) : join(agentsDir(root), rel);
    const hashed = /\/candidates\/[^/]+$/.test(rel) && existsSync(absolute);
    return { file: rel, sha256: hashed ? sha256Hex(readFileSync(absolute)) : null };
  });
}

function uniqueRunId(root: string, loop: LoopName, stamp: string, slug: string): string {
  const base = `${stamp}-${slugOf(slug)}`;
  for (let n = 1; n <= 99; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!existsSync(runStatePath(root, id)) && !existsSync(join(ledgerDir(root, loop), `${id}.json`))) return id;
  }
  throw new Error(`clossys run: run ids ${base}..-99 are all taken`);
}

const pinDocText = (root: string, subject: { agent: AgentId; slotId: string }): string | null => {
  const file = pinPath(root, subject.agent, subject.slotId);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
};

const pinSha = (root: string, subject: { agent: AgentId; slotId: string } | undefined): string | null => {
  if (!subject) return null;
  const resolved = resolveSlot(root, subject.agent, subject.slotId);
  return resolved.state === "pinned" ? resolved.sha256 : null;
};

function readEntry(root: string, name: string): QueueEntry | undefined {
  const found = findQueueEntry(root, name);
  if (!found.ok) return undefined;
  const read = readQueueEntry(found.at);
  return read.ok ? read.entry : undefined;
}

/** The trigger of a new run (flows.md 2): `--trigger`, else read from the loop, the slot and the entry it starts from. */
function triggerOf(loop: LoopName, input: StartInput, subject: SlotSubject | undefined, from: QueueEntry | undefined): string {
  if (input.trigger) return input.trigger;
  if (loop === "loop.release") return "T8";
  if (loop === "loop.audit") return "T6";
  if (loop === "loop.fill") return from ? "T4" : "T2";
  if (from) return from.queue === "queue.fix" && from.createdBy.actor === "owner" ? "T5" : "T6";
  return subject?.slot.status === "needs-refresh" ? "T7" : "T3";
}

export type StartPlan = { ok: true; state: RunState; loaded: LoadedLoop } | { ok: false; reason: string };

/** Checks the input and builds a new run's state. Writes nothing. */
export function planRun(root: string, input: StartInput, at: Iso): StartPlan {
  const load = loadLoopVersion(root, input.loop);
  if (!load.ok) return { ok: false, reason: load.reason };
  const version = load.loaded.content;
  const needs = LOOP_SUBJECT[input.loop];
  // B8: every id the caller hands in is checked before it reaches a path or an argv.
  if (input.slot !== undefined && !SLOT_REF.test(input.slot)) return { ok: false, reason: `--slot ${JSON.stringify(input.slot)} is not a slot ref (<agent>/<slot-id>)` };
  if (input.from !== undefined && !ENTRY_NAME.test(input.from)) return { ok: false, reason: `--from ${JSON.stringify(input.from)} is not a queue entry (queue.<pick|approve|clarify|fix>#<id>)` };
  if (input.publication !== undefined && !PUBLICATION_ID.test(input.publication)) return { ok: false, reason: `--publication ${JSON.stringify(input.publication)} is not a publication id` };
  if (input.trigger !== undefined && !TRIGGER_CODE.test(input.trigger)) return { ok: false, reason: `--trigger ${JSON.stringify(input.trigger)} is not a trigger (T1-T8)` };
  let from: QueueEntry | undefined;
  if (input.from !== undefined) {
    from = readEntry(root, input.from);
    if (!from) return { ok: false, reason: `--from ${input.from}: no such queue entry` };
    if (from.status !== "open") return { ok: false, reason: `--from ${entryName(from)} is ${from.status}; a run starts from an open entry` };
  }
  let subject: SlotSubject | undefined;
  if (needs === "slot") {
    const fromRef = from ? from.subject.to.split("/").slice(0, 2).join("/") : undefined;
    // B6: an entry the run starts from (and closes when done) must be about the slot the run is for.
    if (input.slot !== undefined && fromRef !== undefined && fromRef !== input.slot) return { ok: false, reason: `--from ${entryName(from!)} is about ${fromRef}, not --slot ${input.slot}` };
    const ref = input.slot ?? fromRef;
    if (!ref) return { ok: false, reason: `${input.loop} runs for one slot: --slot <agent>/<slot-id> or --from <entry>` };
    if (!SLOT_REF.test(ref)) return { ok: false, reason: `${ref} (from ${entryName(from!)}) is not a slot ref` };
    const [agent, slotId] = ref.split("/") as [AgentId, string];
    subject = slotId ? readSubject(root, agent, slotId) : undefined;
    if (!subject) return { ok: false, reason: `${ref} is not a consumer slot (clossys/agents/${ref}/slot.json, slot/2)` };
  }
  if (needs === "publication" && !input.publication) return { ok: false, reason: `${input.loop} runs for one publication: --publication <id>` };
  if (needs !== "slot" && input.slot) return { ok: false, reason: `${input.loop} takes no --slot` };
  if (needs !== "slot" && from) {
    const about = from.subject.to;
    const own = input.publication ? `publisher/release.${input.publication}` : undefined;
    if (needs === "publication" && about !== own) return { ok: false, reason: `--from ${entryName(from)} is about ${about}, not ${own ?? "a publication"}` };
  }
  const code = triggerOf(input.loop, input, subject, from);
  if (!LOOP_TRIGGERS[input.loop].includes(code)) return { ok: false, reason: `trigger ${code} does not start ${input.loop} (it answers ${LOOP_TRIGGERS[input.loop].join(", ")})` };
  if (!version.trigger.includes(code)) return { ok: false, reason: `${load.loaded.ref} does not answer trigger ${code} (it answers ${version.trigger.join(", ")})` };
  const fromRef: Ref | undefined = from ? { to: `producer/${from.queue}` as Ref["to"], record: from.id, rel: "raisedBy" } : undefined;
  const slug = `${loopStem(input.loop)}-${subject ? subject.slotId.replace(/\./g, "-") : input.publication ?? loopStem(input.loop)}`;
  const state: RunState = {
    schema: "clossys.loop-run/1",
    runId: uniqueRunId(root, input.loop, entryStamp(at), slug),
    loop: input.loop,
    version: { candidate: load.loaded.candidate, ref: load.loaded.ref, sha256: load.loaded.sha256, source: load.loaded.source },
    ...(subject ? { subject: { agent: subject.agent, slotId: subject.slotId } } : {}),
    ...(input.publication ? { publication: input.publication } : {}),
    trigger: { code, kind: TRIGGER_KINDS[code]!, ...(fromRef ? { ref: fromRef } : {}) },
    ...(from ? { from: entryName(from) } : {}),
    startedAt: at, status: "running", cursor: 0, round: 1,
    startPin: pinSha(root, subject),
    ...(subject ? { startPinDoc: pinDocText(root, subject) } : {}),
    steps: [], checks: {}, decisions: [], refs: [], raised: [], vars: {}, findings: [],
  };
  return { ok: true, state, loaded: load.loaded };
}

export async function startRun(root: string, input: StartInput, hooks: RunHooks, options: RunOptions = {}): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const plan = planRun(root, input, iso(now()));
  if (!plan.ok) return { exitCode: 2, message: `run: ${plan.reason}` };
  const lock = takeRunLock(root, plan.state.runId);
  if ("busy" in lock) return { exitCode: 2, message: `run: ${lock.busy}` };
  try {
    if (existsSync(runStatePath(root, plan.state.runId))) return { exitCode: 2, message: `run: ${plan.state.runId} was started meanwhile; resume it` };
    saveState(root, plan.state);
    return await advance(root, plan.state, plan.loaded.content, hooks, now);
  } finally { lock.release(); }
}

/** Resumes a waiting run. A finished step never runs again; the waiting step runs (or is read from its entry). */
export async function resumeRun(root: string, runId: string, hooks: RunHooks, options: RunOptions = {}): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  if (!RUN_ID.test(runId)) return { exitCode: 2, message: `run: ${JSON.stringify(runId)} is not a run id (<yyyymmdd>T<hhmm>Z-<slug>)` };
  const lock = takeRunLock(root, runId);
  if ("busy" in lock) return { exitCode: 2, message: `run: ${lock.busy}` };
  try { return await resumeLocked(root, runId, hooks, now); } finally { lock.release(); }
}

async function resumeLocked(root: string, runId: string, hooks: RunHooks, now: () => Date): Promise<RunResult> {
  const state = readRunState(root, runId);
  if (!state) return { exitCode: 2, message: `run: no run ${runId} in .clossys/runs/loops/` };
  if (state.status !== "waiting" && state.status !== "running") return { exitCode: 2, state, message: `run: ${runId} is ${state.status}; only a waiting run resumes` };
  // B9: a run that wrote its ledger entry but stopped before saving its state has ended: adopt the entry, run nothing.
  const ended = adoptLedger(root, state);
  if (ended) return ended;
  const load = loadLoopVersion(root, state.loop);
  if (!load.ok) return { exitCode: 2, state, message: `run: ${load.reason}` };
  if (load.loaded.sha256 !== state.version.sha256) {
    return { exitCode: 2, state, message: `run: ${runId} started on ${state.version.ref} (${state.version.sha256.slice(0, 12)}); the loop now runs ${load.loaded.ref}. Finish or stop the run before the version changes` };
  }
  return advance(root, state, load.loaded.content, hooks, now);
}

interface Context { readonly root: string; readonly state: RunState; readonly version: LoopVersion; readonly hooks: RunHooks; readonly now: () => Date }

function subjectOf(ctx: Context): SlotSubject | undefined {
  return ctx.state.subject ? readSubject(ctx.root, ctx.state.subject.agent, ctx.state.subject.slotId) : undefined;
}

function varsOf(ctx: Context, subject: SlotSubject | undefined): Record<string, string> {
  return {
    ...(subject ? slotVars(subject) : {}),
    ...(ctx.state.publication ? { pub: ctx.state.publication } : {}),
    ...ctx.state.vars,
  };
}

/**
 * Records a finished step and its checks. A check in VERIFIED_CHECKS is computed here, never taken from the step's
 * exit (B3): a step that says 0 while its pin does not resolve is recorded as failed. A check the verb did not run
 * (`ran`, B7) is recorded as not run, never as a pass. Returns the step's exit as recorded and why it changed.
 */
function recordStep(ctx: Context, step: LoopStep, decider: Decider, cli: string, exit: Exit, wrote: readonly string[] | undefined, vars: Record<string, string>, ran?: readonly string[]): { exit: Exit; why?: string } {
  const results: [string, "pass" | "fail"][] = [];
  let recorded = exit;
  const why: string[] = [];
  for (const check of step.checks) {
    const filled = fillNames(check, vars);
    if (filled.unfilled.length) continue;
    const name = filled.text;
    if (ran && !ran.includes(name)) {
      const notRun = ctx.state.notRun ?? (ctx.state.notRun = []);
      if (!notRun.includes(name)) notRun.push(name);
      continue;
    }
    if (exit === 0 && VERIFIED_CHECKS.includes(name)) {
      const verified = verifyCheck(ctx, name);
      results.push([name, verified.ok ? "pass" : "fail"]);
      if (!verified.ok) { recorded = 1; why.push(verified.why); }
      continue;
    }
    results.push([name, exit === 0 ? "pass" : "fail"]);
  }
  ctx.state.steps.push({ id: step.id, decider, cli, exit: recorded, wrote: wroteOf(ctx.root, wrote) });
  for (const [name, result] of results) ctx.state.checks[name] = result;
  return { exit: recorded, ...(why.length ? { why: why.join("; ") } : {}) };
}

const resolutionIssue = (resolution: Resolution): string | undefined =>
  resolution.state === "unresolved" ? [resolution.pinIssue, resolution.reason].filter(Boolean).join("; ")
    : resolution.state === "sample" ? resolution.pinIssue : undefined;

/** `pins.resolve` and `release.ready`, computed from the files (B3). */
export function verifyCheck(ctx: { readonly root: string; readonly state: RunState }, name: string): { ok: true } | { ok: false; why: string } {
  const { root, state } = ctx;
  if (name === "pins.resolve") {
    if (!state.subject) {
      const run = checkPinsResolve(root);
      return run.status === "pass" ? { ok: true } : { ok: false, why: `pins.resolve: ${run.findings.map(finding => `${finding.subject} ${finding.detail}`).join("; ")}` };
    }
    const { agent, slotId } = state.subject;
    const ref = `${agent}/${slotId}`;
    const pin = readPinFile(pinPath(root, agent, slotId), { agent, slotId });
    const resolutions = isRecordSlot(root, agent, slotId, pin) ? slotRecords(root, agent, slotId).map(record => resolveSlot(root, agent, slotId, record)) : [resolveSlot(root, agent, slotId)];
    const issues = resolutions.map(resolutionIssue).filter((issue): issue is string => !!issue);
    if (issues.length) return { ok: false, why: `pins.resolve: ${ref} does not resolve: ${issues.join("; ")}` };
    if (!resolutions.some(resolution => resolution.state === "pinned")) return { ok: false, why: `pins.resolve: ${ref} has no pin; it still resolves to the package sample` };
    return { ok: true };
  }
  if (name === RELEASE_READY) {
    const pub = state.publication, manifest = state.vars.manifest, entry = state.vars.entry;
    if (!pub || !manifest || !entry) return { ok: false, why: `${RELEASE_READY}: the run has no manifest or no owner sign-off` };
    const resolved = resolveSlot(root, "publisher", `release.${pub}`);
    if (resolved.state !== "pinned") return { ok: false, why: `${RELEASE_READY}: publisher/release.${pub} is not pinned${resolved.state === "unresolved" ? ` (${resolutionIssue(resolved)})` : ""}` };
    if (resolved.candidate !== manifest) return { ok: false, why: `${RELEASE_READY}: publisher/release.${pub} pins ${resolved.candidate}, not this run's manifest ${manifest}` };
    if (!OWNER_BASES.includes(resolved.pin.basis) || resolved.pin.decidedBy !== `owner:${entry}`) return { ok: false, why: `${RELEASE_READY}: publisher/release.${pub} is pinned by ${resolved.pin.decidedBy} (basis ${resolved.pin.basis}), not the owner's sign-off ${entry}` };
    return { ok: true };
  }
  return { ok: false, why: `${name} is not a check clossys run computes` };
}

/** B1: an agent pick step does not run for a slot an owner `queue.pick` step of this version picks. */
function ownerPicks(version: LoopVersion, step: LoopStep, subject: SlotSubject | undefined): boolean {
  if (step.decider.by !== "agent" || step.decider.verb !== AGENT_PICK_VERB) return false;
  return version.steps.some(other => other.decider.by === "human" && other.decider.raise === OWNER_PICK_RAISE && whenMatches(other.when, subject));
}

async function advance(root: string, state: RunState, version: LoopVersion, hooks: RunHooks, now: () => Date): Promise<RunResult> {
  const ctx: Context = { root, state, version, hooks, now };
  const pendingRetry = state.pendingRaise?.then === "retry" ? state.pendingRaise : undefined;
  if (pendingRetry) {
    // The clarify a failed step asks was being raised when the run last stopped: adopt or raise it, never run the step again.
    const step = version.steps[state.cursor];
    if (step?.id === pendingRetry.step) return waitOnClarify(ctx, step, subjectOf(ctx));
    delete state.pendingRaise;
  }
  const retry = await readRetry(ctx);
  if (retry) return retry;
  state.status = "running";
  while (state.cursor < version.steps.length) {
    const step = version.steps[state.cursor]!;
    const subject = subjectOf(ctx);
    if (state.subject && !subject) return stop(ctx, `${state.subject.agent}/${state.subject.slotId} is no longer a consumer slot`, 2);
    // B9: the step the run waits on (or was raising an entry for) runs, whatever its `when` now says.
    const held = state.waiting?.step === step.id || state.pendingRaise?.step === step.id;
    if (!held && !whenMatches(step.when, subject)) { state.cursor++; continue; }
    if (!held && ownerPicks(version, step, subject)) { state.cursor++; continue; }
    const vars = varsOf(ctx, subject);
    const filled = stepArgv(step.cli, vars);
    const decider = step.decider;

    if (decider.by === "human") {
      const result = await humanStep(ctx, step, subject, vars, filled.text);
      if (result) return result;
      continue;
    }

    let exit: Exit; let wrote: readonly string[] | undefined; let findings: readonly Finding[] = []; let ledgerDecider: Decider; let cli = filled.text;
    let ran: readonly string[] | undefined;
    if (decider.by === "agent") {
      const agent = decider.agent === OWNER_OF_SLOT ? subject?.agent : decider.agent;
      if (!agent) return stop(ctx, `step ${step.id} names ${OWNER_OF_SLOT}, but ${state.loop} runs for no slot`, 2);
      const skill = skillFor(root, decider.skill, agent);
      const packet: AgentPacket = {
        runId: state.runId, step: step.id, agent, verb: decider.verb, tier: decider.tier, cli: filled.text, round: state.round,
        ...(skill ? { skill } : {}), ...(subject ? { ref: refOf(subject) } : {}), ...(state.from ? { from: state.from } : {}),
      };
      const outcome = await hooks.agent(packet);
      if (outcome === "wait") {
        state.status = "waiting"; state.waiting = { step: step.id, on: "agent" };
        saveState(root, state);
        return { exitCode: 0, state, packet, message: `run ${state.runId}: step ${step.id} waits for agent:${agent} (${decider.verb}, ${decider.tier})` };
      }
      exit = outcome.exit; wrote = outcome.wrote; cli = outcome.cli ?? filled.text;
      ledgerDecider = { by: "agent", agent, verb: decider.verb, tier: decider.tier, model: outcome.model, ...(skill ? { skill } : {}) };
    } else {
      ledgerDecider = { by: "code" };
      const builtIn = codeBuiltIn(ctx, step, subject);
      if (builtIn) ({ exit, wrote } = builtIn);
      else if (filled.unfilled.length) { exit = 2; wrote = []; }
      else {
        const outcome = await hooks.code({ runId: state.runId, step: step.id, cli: filled.text, argv: filled.argv, ...(subject ? { ref: refOf(subject) } : {}), ...(state.publication ? { publication: state.publication } : {}) });
        exit = outcome.exit; wrote = outcome.wrote; findings = outcome.findings ?? []; ran = outcome.ran;
      }
    }
    delete state.waiting;
    if (step.id === "manifest" && state.publication && exit === 0) {
      // B4: the manifest is the release candidate the verb wrote, read from its files (never the first file it names).
      const manifest = manifestOf(root, state.publication, wrote);
      if (manifest) state.vars.manifest = manifest;
      else exit = 1;
    }
    const recorded = recordStep(ctx, step, ledgerDecider, cli, exit, wrote, vars, ran);
    state.findings = [...findings];
    if (recorded.why && !step.onFail) return stop(ctx, `step ${step.id} failed: ${recorded.why}`, 1);
    const result = await afterStep(ctx, step, recorded.exit, findings, subject);
    if (result) return result;
  }
  return finish(ctx);
}

/** The release candidate a manifest step wrote: `publisher/release.<pub>/candidates/<name>`. */
function manifestOf(root: string, publication: string, wrote: readonly string[] | undefined): string | undefined {
  const prefix = `publisher/release.${publication}/candidates/`;
  for (const file of wrote ?? []) {
    const rel = ledgerPath(root, file);
    if (!rel.startsWith(prefix)) continue;
    const name = rel.slice(prefix.length);
    if (CANDIDATE_NAME.test(name) && existsSync(join(agentsDir(root), rel))) return name;
  }
  return undefined;
}

/** The two code steps the runner runs itself. */
function codeBuiltIn(ctx: Context, step: LoopStep, subject: SlotSubject | undefined): { exit: Exit; wrote: string[] } | undefined {
  const { root, state } = ctx;
  if (step.cli === "clossys check --route") {
    const raised = routeFindings(root, state.findings, iso(ctx.now()), state.loop);
    for (const entry of raised) state.raised.push(entryName(entry));
    return { exit: 0, wrote: raised.map(entry => `producer/${entry.queue}/entries/${entry.id}.json`) };
  }
  if (step.cli.includes("<dependants>")) {
    if (!subject) return { exit: 2, wrote: [] };
    const wrote: string[] = [];
    const missing = subject.slot.refs.filter(ref => ref.rel === "consumedBy" && !readSubject(root, ref.to.split("/")[0] as AgentId, ref.to.split("/")[1] ?? ""));
    if (pinSha(root, subject) !== state.startPin) {
      for (const dependant of dependantsOf(root, subject)) {
        if (dependant.slot.status === "retired" || dependant.slot.status === "parked" || dependant.slot.status === "needs-refresh") continue;
        const file = join(root, "clossys", "agents", dependant.agent, dependant.slotId, "slot.json");
        if (writeSlot(file, { ...dependant.slot, status: "needs-refresh", updatedAt: iso(ctx.now()) })) wrote.push(`${refOf(dependant)}/slot.json`);
      }
    }
    // flows.md F7 step 2: a dependant that ran clean goes back to live.
    if (subject.slot.status === "needs-refresh") {
      const file = join(root, "clossys", "agents", subject.agent, subject.slotId, "slot.json");
      if (writeSlot(file, { ...subject.slot, status: "live", updatedAt: iso(ctx.now()) })) wrote.push(`${refOf(subject)}/slot.json`);
    }
    return { exit: missing.length ? 1 : 0, wrote };
  }
  return undefined;
}

/** onFail and exit 2 (null: go on). */
async function afterStep(ctx: Context, step: LoopStep, exit: Exit, findings: readonly Finding[], subject: SlotSubject | undefined): Promise<RunResult | null> {
  const { root, state, version } = ctx;
  if (exit === 0) { state.cursor++; saveState(root, state); return null; }
  if (exit === 2) return stop(ctx, `step ${step.id} could not run (exit 2)`, 2);
  const next = version.steps[state.cursor + 1];
  if (!step.onFail) {
    // A failing check whose next step routes findings hands them on (flows.md F6: route after check).
    if (next?.cli === "clossys check --route") { state.cursor++; saveState(root, state); return null; }
    return stop(ctx, `step ${step.id} failed`, 1);
  }
  const at = iso(ctx.now());
  const label = `${state.loop} ${step.id}`;
  if (step.onFail.then !== "retry") {
    const raised = findings.length ? routeFindings(root, findings, at, label) : [raiseFor(ctx, step.onFail.raise, subject, `${label} failed${state.publication ? ` for ${state.publication}` : ""}`, at)].filter((e): e is QueueEntry => e !== undefined);
    for (const entry of raised) state.raised.push(entryName(entry));
    const names = raised.map(entryName);
    return stop(ctx, `${step.id} failed; ${names.length ? `raised ${names.join(", ")}; ` : ""}${step.onFail.then} runs from ${names[0] ?? "the open entry"}`, 1);
  }
  if (step.onFail.raise === "queue.clarify") return waitOnClarify(ctx, step, subject);
  state.round++;
  if (state.round > version.maxRounds) {
    const entry = raiseFor(ctx, "queue.clarify", subject, `${version.maxRounds} rounds of ${state.loop} did not pass ${step.id}${subject ? ` for ${refOf(subject)}` : ""}`, at, false);
    if (entry) state.raised.push(entryName(entry));
    return stop(ctx, `${step.id} failed ${version.maxRounds} rounds (maxRounds); raised ${entry ? entryName(entry) : "nothing"}`, 1);
  }
  const fix = raiseFor(ctx, "queue.fix", subject, `${label} failed${subject ? ` for ${refOf(subject)}` : ""}; round ${state.round} of ${version.maxRounds}`, at);
  if (fix && !state.raised.includes(entryName(fix))) state.raised.push(entryName(fix));
  let back = state.cursor;
  for (let index = state.cursor - 1; index >= 0; index--) {
    const earlier = version.steps[index]!;
    if (earlier.decider.by === "agent" && earlier.decider.verb === "create-candidates") { back = index; break; }
  }
  state.cursor = back;
  saveState(root, state);
  return null;
}

function raiseOf(ctx: Context, queue: "queue.fix" | "queue.clarify", subject: SlotSubject | undefined, ask: string): Raise | undefined {
  const publicationRef = ctx.state.publication ? `publisher/release.${ctx.state.publication}` : undefined;
  const to = subject ? refOf(subject) : publicationRef;
  if (!to) return undefined;
  const agent = (subject?.agent ?? "publisher") as AgentId;
  const decider: QueueEntry["decider"] = queue === "queue.fix" ? `agent:${agent}` : "owner";
  return { queue, subject: { to: to as Ref["to"], rel: "input" }, decider, ask, slug: to.split("/")[1]! };
}

function raiseFor(ctx: Context, queue: "queue.fix" | "queue.clarify", subject: SlotSubject | undefined, ask: string, at: Iso, dedupe = true): QueueEntry | undefined {
  const raise = raiseOf(ctx, queue, subject, ask);
  return raise ? raiseEntry(ctx.root, raise, at, dedupe).entry : undefined;
}

/** The open entry a run raised at `at` for `raise` before it stopped, if the raise got that far (B9). */
function raisedBefore(root: string, raise: Raise, at: Iso): QueueEntry | undefined {
  for (const file of listQueueEntryFiles(root)) {
    if (file.queue !== raise.queue) continue;
    const read = readQueueEntry(file);
    if (!read.ok) continue;
    const entry = read.entry;
    if (entry.createdAt === at && entry.subject.to === raise.subject.to && entry.ask === raise.ask && entry.createdBy.actor === "code") return entry;
  }
  return undefined;
}

/**
 * Raises an owner entry once (B9): the intent is saved before the raise, so a run that stops between the raise and
 * its next state save adopts the entry it raised instead of raising a second one.
 */
function raiseOnce(ctx: Context, step: string, raise: Raise, then?: "retry"): QueueEntry {
  const { root, state } = ctx;
  const pending = state.pendingRaise?.step === step && state.pendingRaise.queue === raise.queue ? state.pendingRaise : undefined;
  const at = pending?.at ?? iso(ctx.now());
  const adopted = pending ? raisedBefore(root, raise, at) : undefined;
  if (!pending) { state.pendingRaise = { step, queue: raise.queue, at, ...(then ? { then } : {}) }; saveState(root, state); }
  const entry = adopted ?? raiseEntry(root, raise, at, false).entry;
  delete state.pendingRaise;
  return entry;
}

/** A failed step whose onFail asks the owner (`queue.clarify` then `retry`): raise once, wait, then run it again. */
function waitOnClarify(ctx: Context, step: LoopStep, subject: SlotSubject | undefined): Promise<RunResult> {
  const { root, state } = ctx;
  const raise = raiseOf(ctx, "queue.clarify", subject, `${state.loop} ${step.id} failed${subject ? ` for ${refOf(subject)}` : ""}: what should it do?`);
  if (!raise) { delete state.pendingRaise; return stop(ctx, `step ${step.id} failed and no clarify entry could be raised`, 1); }
  const entry = raiseOnce(ctx, step.id, raise, "retry");
  if (!state.raised.includes(entryName(entry))) state.raised.push(entryName(entry));
  state.status = "waiting"; state.waiting = { step: step.id, on: "entry", entry: entryName(entry), then: "retry" };
  saveState(root, state);
  return Promise.resolve({ exitCode: 0, state, entry: entryName(entry), message: `run ${state.runId}: ${step.id} failed; waits for the owner on ${entryName(entry)}` });
}

/** A human step: raise its entry, or read the entry it waits on. Returns a result when the run stops or waits. */
async function humanStep(ctx: Context, step: LoopStep, subject: SlotSubject | undefined, vars: Record<string, string>, cli: string): Promise<RunResult | null> {
  const { root, state } = ctx;
  const decider = step.decider as Extract<LoopStep["decider"], { by: "human" }>;
  const waiting = state.waiting?.step === step.id && state.waiting.on === "entry" ? state.waiting : undefined;
  if (waiting) {
    const entry = readEntry(root, waiting.entry);
    if (!entry) return stop(ctx, `${waiting.entry} is gone`, 2);
    if (entry.status === "open") {
      saveState(root, state);
      return { exitCode: 0, state, entry: waiting.entry, message: `run ${state.runId}: ${step.id} still waits for the owner on ${waiting.entry}` };
    }
    if (entry.status === "withdrawn") return stop(ctx, `${waiting.entry} was withdrawn`, 0);
    const answer = entry.events[entry.events.length - 1]!.answer!;
    state.decisions.push({ entry: waiting.entry, answer });
    state.refs.push({ to: `producer/${entry.queue}` as Ref["to"], record: entry.id, rel: "answers" });
    delete state.waiting;
    const filled = fillNames(step.cli, { ...vars, entry: entry.id, candidate: answer, words: JSON.stringify(entry.events[entry.events.length - 1]!.quote ?? "") }).text;
    const option = (entry.options ?? []).find(candidate => candidate.id === answer);
    const accepts = entry.queue === "queue.pick" ? option?.candidate !== undefined : answer === "approve" || answer === "ready";
    let wrote: readonly string[] = [];
    let exit: Exit = accepts ? 0 : 1;
    let why = `the owner answered ${answer} on ${waiting.entry}`;
    if (accepts && entry.queue === "queue.pick" && subject) {
      const candidate = option!.candidate!;
      if (!CANDIDATE_NAME.test(candidate)) return stop(ctx, `${waiting.entry} picks ${JSON.stringify(candidate)}, which is not a candidate name`, 2);
      const pin = await ctx.hooks.code({ runId: state.runId, step: step.id, cli: `clossys pin ${refOf(subject)} ${candidate} --by owner:${entryName(entry)}`, argv: ["pin", refOf(subject), candidate, "--by", `owner:${entryName(entry)}`], ref: refOf(subject) });
      exit = pin.exit; wrote = pin.wrote ?? [];
    }
    // B5: the owner's confirm is written on the agent's pin; a reject puts the slot's pin back as the run found it.
    if (entry.queue === "queue.approve" && state.loop !== "loop.release" && subject) {
      const done = accepts ? confirmPin(ctx, subject, entry) : revertPin(ctx, subject);
      wrote = done.wrote;
      if (done.why) { exit = done.exit; why = done.why; }
    }
    state.vars.entry = entryName(entry);
    const recorded = recordStep(ctx, step, { by: "human", who: "owner", raise: decider.raise }, filled, exit, wrote, vars);
    if (recorded.why) return stop(ctx, `step ${step.id} failed: ${recorded.why}`, 1);
    if (exit !== 0) return stop(ctx, why, exit === 2 ? 2 : accepts ? 1 : 0);
    state.cursor++;
    saveState(root, state);
    return null;
  }
  const to = subject ? refOf(subject) : state.publication ? `publisher/release.${state.publication}` : undefined;
  if (!to) return stop(ctx, `step ${step.id} needs a slot or a publication to ask about`, 2);
  let options: QueueEntry["options"];
  let fallback: string | null = null;
  if (decider.raise === "queue.pick") {
    const names = subject ? slotCandidates(root, subject) : [];
    if (!names.length) return stop(ctx, `step ${step.id}: ${to} has no candidates to pick from`, 1);
    options = names.map(name => ({ id: name, candidate: name, summary: `${to}/${name}` }));
  } else if (decider.raise === "queue.approve") {
    const release = state.loop === "loop.release";
    options = release
      ? [{ id: "ready", summary: `mark ${state.vars.manifest ?? "the manifest"} ready` }, { id: "not-ready", summary: "keep the current ready pin" }]
      : [{ id: "approve", summary: `confirm the agent's pick for ${to}` }, { id: "reject", summary: "keep looking" }];
    fallback = release ? "not-ready" : null;
  }
  const entry = raiseOnce(ctx, step.id, {
    queue: decider.raise, subject: { to: to as Ref["to"], rel: "input" }, decider: "owner", ask: `${step.does} (${to})`,
    slug: to.split("/")[1]!, default: fallback, ...(options ? { options } : {}),
  });
  if (!state.raised.includes(entryName(entry))) state.raised.push(entryName(entry));
  state.status = "waiting"; state.waiting = { step: step.id, on: "entry", entry: entryName(entry), then: "continue" };
  saveState(root, state);
  return { exitCode: 0, state, entry: entryName(entry), message: `run ${state.runId}: ${step.id} waits for the owner on ${entryName(entry)}` };
}

/** B5: the owner's approve on a confirm step: the agent's pin gains `confirmed` (by the owner, from this entry). */
function confirmPin(ctx: Context, subject: SlotSubject, entry: QueueEntry): { exit: Exit; wrote: string[]; why?: string } {
  const { root } = ctx;
  const { agent, slotId } = subject;
  const file = pinPath(root, agent, slotId);
  const read = readPinFile(file, { agent, slotId });
  if (read.kind !== "pin" || read.issues.length) return { exit: 1, wrote: [], why: `${refOf(subject)} has no valid pin for the owner to confirm${read.kind === "pin" || read.kind === "invalid" || read.kind === "pin/1" ? `: ${read.issues.join("; ")}` : ""}` };
  const pin = read.doc;
  if (pin.basis !== "agent") return { exit: 1, wrote: [], why: `${refOf(subject)} is pinned by ${pin.decidedBy} (basis ${pin.basis}); only an agent pick is confirmed` };
  const at = iso(ctx.now());
  const answers: Ref = { to: `producer/${entry.queue}` as Ref["to"], record: entry.id, rel: "answers" };
  const doc = {
    ...buildPin({
      agent, slotId, createdBy: pin.createdBy, previous: pin, refs: mergeRefs(pin.refs, [answers]),
      record: { candidate: pin.candidate, sha256: pin.sha256, decidedBy: pin.decidedBy, basis: pin.basis, at: pin.at, confirmed: { by: "owner", ref: entryName(entry), at } },
    }),
    updatedAt: at,
  };
  const issues = pinIssues(doc, { agent, slotId });
  if (issues.length) return { exit: 1, wrote: [], why: `the confirmed pin of ${refOf(subject)} would not be valid: ${issues.join("; ")}` };
  writePinDoc(file, doc);
  return { exit: 0, wrote: [`${refOf(subject)}/pin.json`] };
}

/** B5: the owner rejected the agent's pick: the slot's pin goes back to what it was when the run started. */
function revertPin(ctx: Context, subject: SlotSubject): { exit: Exit; wrote: string[]; why?: string } {
  const { root, state } = ctx;
  const file = pinPath(root, subject.agent, subject.slotId);
  const before = state.startPinDoc ?? null;
  const now = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (now === before) return { exit: 1, wrote: [] };
  if (before === null) unlinkSync(file);
  else {
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, before);
    renameSync(temp, file);
  }
  return { exit: 1, wrote: [`${refOf(subject)}/pin.json`] };
}

/** The clarify a retry waits on: answered, the step runs again (from advance's loop). */
async function readRetry(ctx: Context): Promise<RunResult | null> {
  const { root, state } = ctx;
  const waiting = state.waiting;
  if (!waiting || waiting.on !== "entry" || waiting.then !== "retry") return null;
  const entry = readEntry(root, waiting.entry);
  if (!entry) return stop(ctx, `${waiting.entry} is gone`, 2);
  if (entry.status === "open") return { exitCode: 0, state, entry: waiting.entry, message: `run ${state.runId}: ${waiting.step} still waits for the owner on ${waiting.entry}` };
  if (entry.status === "withdrawn") return stop(ctx, `${waiting.entry} was withdrawn`, 0);
  state.decisions.push({ entry: waiting.entry, answer: entry.events[entry.events.length - 1]!.answer! });
  state.refs.push({ to: `producer/${entry.queue}` as Ref["to"], record: entry.id, rel: "answers" });
  delete state.waiting;
  return null;
}

async function finish(ctx: Context): Promise<RunResult> {
  const { root, state } = ctx;
  // B3: the loop's exit checks hold in the files at the end, whatever the steps said.
  for (const check of EXIT_CHECKS[state.loop]) {
    if (!VERIFIED_CHECKS.includes(check)) continue;
    const verified = verifyCheck(ctx, check);
    state.checks[check] = verified.ok ? "pass" : "fail";
    if (!verified.ok) return stop(ctx, `the run cannot end done: ${verified.why}`, 1);
  }
  const last = state.steps[state.steps.length - 1];
  const ready = state.loop === "loop.release" && last?.exit === 0 && state.checks["release.ready"] === "pass";
  const subject = subjectOf(ctx);
  // The entries this run answers: the one it started from and the fixes it raised on the way (code close, answered by
  // the slot). Only an agent's queue.fix is closed by code; an owner's clarify is the owner's to answer (B6).
  if (subject) {
    for (const name of [state.from, ...state.raised].filter((n): n is string => n !== undefined)) {
      const entry = readEntry(root, name);
      if (!entry || entry.status !== "open" || entry.queue !== "queue.fix" || !entry.decider.startsWith("agent:")) continue;
      answerQueueEntry(root, { entry: name, by: RUN_BY, answer: `${state.loop} ${state.runId} done`, answers: refOf(subject) }, ctx.now());
      state.refs.push({ to: `producer/${entry.queue}` as Ref["to"], record: entry.id, rel: "answers" });
    }
  }
  const outcome = state.loop === "loop.audit"
    ? (state.raised.length ? `raised ${state.raised.join(", ")}` : "no new entry")
    : ready ? `${state.publication ?? "release"} ${state.vars.manifest ?? ""} pinned ready`.replace(/\s+/g, " ").trim()
      : `${subject ? refOf(subject) : state.loop} done${pinSha(root, state.subject) ? `; pinned ${resolveSlotCandidate(root, state)}` : ""}`;
  return writeLedger(ctx, ready ? "pinned-ready" : "done", outcome, 0);
}

function resolveSlotCandidate(root: string, state: RunState): string {
  if (!state.subject) return "";
  const resolved = resolveSlot(root, state.subject.agent, state.subject.slotId);
  return resolved.state === "pinned" ? resolved.candidate : "";
}

function stop(ctx: Context, why: string, exitCode: Exit): Promise<RunResult> {
  return Promise.resolve(writeLedger(ctx, "stopped", why, exitCode));
}

/** A run whose ledger entry was written before its state was saved: adopt the entry, never write a second (B9). */
function adoptLedger(root: string, state: RunState): RunResult | undefined {
  const file = join(ledgerDir(root, state.loop), `${state.runId}.json`);
  if (!existsSync(file)) return undefined;
  const entry = JSON.parse(readFileSync(file, "utf8")) as LedgerEntry;
  state.status = entry.status as RunState["status"]; state.outcome = entry.outcome; state.ledger = ledgerPath(root, file);
  delete state.waiting; delete state.pendingRaise;
  saveState(root, state);
  return { exitCode: entry.status === "stopped" ? 1 : 0, state, message: `run ${state.runId}: ${entry.status}: ${entry.outcome}` };
}

function writeLedger(ctx: Context, status: RunState["status"] & LedgerEntry["status"], outcome: string, exitCode: Exit): RunResult {
  const { root, state } = ctx;
  const at = iso(ctx.now());
  if (state.notRun?.length) outcome = `${outcome}; not run: ${state.notRun.join(", ")}`;
  const seen = new Set<string>();
  const refs = state.refs.filter(ref => { const key = `${ref.to}#${ref.record ?? ""}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const entry: LedgerEntry = {
    schema: "clossys.ledger-entry/1",
    id: state.runId,
    agent: "producer",
    kind: "ledger-entry",
    status,
    createdBy: { actor: "code", cli: RUN_CLI, version: producerVersion() },
    createdAt: at,
    refs,
    loop: state.loop,
    loopVersion: state.version.candidate,
    trigger: { kind: state.trigger.kind, ...(state.trigger.ref ? { ref: state.trigger.ref } : {}) },
    steps: state.steps,
    checks: state.checks,
    decisions: state.decisions,
    outcome,
  };
  const issues = validateAgainst(recordSchema("ledger-entry.json"), entry);
  if (issues.length) throw new Error(`clossys run: the ledger entry would not be valid: ${issues.map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
  const file = join(ledgerDir(root, state.loop), `${state.runId}.json`);
  mkdirSync(dirname(file), { recursive: true });
  let fd: number;
  try { fd = openSync(file, "wx"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return adoptLedger(root, state)!;
  }
  try { writeSync(fd, `${JSON.stringify(entry, null, 2)}\n`); } finally { closeSync(fd); }
  state.status = status; state.outcome = outcome; state.ledger = ledgerPath(root, file);
  delete state.waiting;
  saveState(root, state);
  return { exitCode, state, message: `run ${state.runId}: ${status}: ${outcome}` };
}

/**
 * flows.md F1 (T1): `clossys ia sync`, then `clossys check`, then one ledger entry `<stamp>-fill-init` with
 * `outcome: "initialized"`. Not a loop version of its own: it is the one-time prelude of `loop.fill`.
 */
export async function runInit(root: string, hooks: RunHooks, options: RunOptions = {}): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const load = loadLoopVersion(root, "loop.fill");
  if (!load.ok) return { exitCode: 2, message: `run: ${load.reason}` };
  const at = iso(now());
  const state: RunState = {
    schema: "clossys.loop-run/1", runId: uniqueRunId(root, "loop.fill", entryStamp(at), "fill-init"), loop: "loop.fill",
    version: { candidate: load.loaded.candidate, ref: load.loaded.ref, sha256: load.loaded.sha256, source: load.loaded.source },
    trigger: { code: "T1", kind: TRIGGER_KINDS.T1! }, startedAt: at, status: "running", cursor: 0, round: 1, startPin: null,
    steps: [], checks: {}, decisions: [], refs: [], raised: [], vars: {}, findings: [],
  };
  const ctx: Context = { root, state, version: load.loaded.content, hooks, now };
  const prelude: { id: string; cli: string; checks: string[] }[] = [
    { id: "ia-sync", cli: "clossys ia sync", checks: ["ia.orphans", "records.computed-match"] },
    { id: "check", cli: "clossys check", checks: ["pins.resolve"] },
  ];
  for (const step of prelude) {
    const outcome = await hooks.code({ runId: state.runId, step: step.id, cli: step.cli, argv: stepArgv(step.cli, {}).argv.slice(1) });
    state.steps.push({ id: step.id, decider: { by: "code" }, cli: step.cli, exit: outcome.exit, wrote: wroteOf(root, outcome.wrote) });
    for (const check of step.checks) state.checks[check] = outcome.exit === 0 ? "pass" : "fail";
    if (outcome.exit !== 0) return writeLedger(ctx, "stopped", `init stopped at ${step.id} (exit ${outcome.exit})`, outcome.exit);
  }
  return writeLedger(ctx, "done", "initialized", 0);
}

/**
 * flows.md F2 repeat: `loop.fill` for the next slot still on a package default (chain order), again and again, until
 * none is left or a run waits or stops. A slot filled once in this call is not filled again in it.
 */
export async function fillAll(root: string, hooks: RunHooks, options: RunOptions & { readonly limit?: number } = {}): Promise<RunResult[]> {
  const results: RunResult[] = [];
  const done = new Set<string>();
  for (let n = 0; n < (options.limit ?? 1000); n++) {
    const subject = nextFillSlot(root, done);
    if (!subject) break;
    done.add(refOf(subject));
    const result = await startRun(root, { loop: "loop.fill", slot: refOf(subject) }, hooks, options);
    results.push(result);
    if (result.exitCode !== 0 || result.state?.status !== "done") break;
  }
  return results;
}
