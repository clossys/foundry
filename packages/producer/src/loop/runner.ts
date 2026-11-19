/**
 * The loop runner behind `clossys run loop.<name>` (producer.md 10, flows.md 3-4).
 *
 * One step at a time, in the order of the version that runs (the consumer pin, else package v1; version.ts):
 *
 * - a step whose `when` does not match the slot is skipped and left out of the ledger;
 * - a code step runs through `hooks.code` (the CLI runs the verb); two are built in: `clossys check --route` routes the
 *   previous step's findings (route.ts) and `clossys check <dependants>` runs the cascade (cascade.ts): every pin
 *   whose pinSet a repin changed is judged again by the one certifier, a failure marks its slot `needs-refresh` and is
 *   a kind fix (clossys.queue-entry/2, with its cause) for the slot's owner (CHOOSE or CREATE), to a fixed point within
 *   `maxRounds`, then a `queue.clarify`;
 *   a legacy `consumedBy` dependant is marked `needs-refresh` when this run changed the slot's pin (flows.md F7 step 1);
 * - an agent step hands `hooks.agent` a packet (agent, verb, tier, skill, cli); the agent answers with its exit, the
 *   files it wrote and the model that served it, or `wait`;
 * - a human step raises a queue entry for the owner and the run waits. It resumes only from the entry: open keeps
 *   waiting, answered records the decision and goes on, withdrawn stops the run.
 *
 * A failed step follows its `onFail`: `retry` after a `queue.clarify` waits for the owner and runs the step again;
 * `retry` after a `queue.fix` raises a kind fix on the slot (its check, findings and cause; foundry-build-0048 Q10) and
 * goes back to the create step (one round more, at most `maxRounds`, then a `queue.clarify` and a stop); `loop.<name>`
 * raises the entry and stops the run so that loop takes it. Exit 2 stops. A done run closes the change or fix it
 * started from and the fixes it raised on its own slot through the closure rule (records/request.ts closeWork).
 *
 * Run state is kept in `.clossys/runs/loops/<runId>.json`; resuming never runs a finished step again. Every run that
 * ends (done, stopped or pinned-ready) writes one ledger entry, `clossys/agents/producer/ledger.<loop>/entries/<runId>.json`.
 */
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, writeSync, readFileSync, realpathSync, renameSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { appendRecord, buildRecord, invocationOf, observe } from "../pipeline/trace.js";
import { basename, dirname, join, relative, sep } from "node:path";
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
import { RUN_BY, RUN_CLI, entryName, producerVersion, raiseEntry, raiseFix, raisedOf, routeFindings, type Finding, type Raise, type Raised } from "./route.js";
import { dependantsOf, fillNames, MissingSkillError, nextFillSlot, readSubject, refOf, skillFor, slotCandidates, slotVars, stepArgv, whenMatches, type SlotSubject } from "./slots.js";
import {
  AGENT_PICK_VERB, CANDIDATES_CERTIFIED, CASCADE_CLEAN, REQUEST_CLOSED, REQUESTS_FILED, CANDIDATE_NAME, ENTRY_NAME, EXIT_CHECKS, LOOP_SUBJECT, LOOP_TRIGGERS, OWNER_OF_SLOT, OWNER_PICK_RAISE, PUBLICATION_ID, RELEASE_READY, RUN_ID,
  SLOT_REF, TRIGGER_CODE, TRIGGER_KINDS, VERIFIED_CHECKS, ledgerOf, loopStem, type LoopName,
} from "./names.js";
import { loadLoopVersion, type LoadedLoop } from "./version.js";
import { agentWriteClass, currentStandardOf, isAgentLoop, isLoopAgent, pathPattern, patternsMeet, standardOwnWrites, type LoopAgent } from "./agent-loops.js";
import { judgeSnapshot, keepSnapshot, keptSnapshot, snapshotKey, treeSnapshot, type AgentSnapshot, type TreeFiles } from "./agent-snapshot.js";
import { checkReleaseReady } from "../release/ready.js";
import { certifiedOptions } from "../constitution/pin-gate.js";
import { closeWork, freshRaiseIssues, isContentAgent, readRequest, REQUEST_ID, RequestError, targetOf, unfiledNeeds, workQueue, type SlotRequest } from "../records/request.js";
import { FIX_CHECKS } from "../queue/requester-check.js";
import { cascadeClean, runCascade } from "./cascade.js";
import { CASCADE_REVERDICT } from "../constitution/cascade.js";

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
  /** A request run (loop.slot): the clossys.queue-entry/2 kind slot id the agent decides. */
  readonly request?: string;
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
  /** The agent whose own pinned loop the run runs (U9a): the slot's agent, the request's owner, or loop.scope's --agent. */
  agent?: LoopAgent;
  /** A request run (loop.slot): the clossys.queue-entry/2 kind slot entry it answers (clossys/agents/producer/queue.slot/entries/<id>.json). */
  request?: string;
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
  /**
   * U9a fix round 4: what `clossys/` and `.clossys/` held right before an agent step of an agent's own loop was handed
   * to the agent, kept while the run waits on it; the step's answer is judged against it (agent-snapshot.ts).
   */
  agentSnapshot?: AgentSnapshot;
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
  /** loop.slot: the open request the run answers. */
  readonly request?: string;
  /** loop.scope: the agent whose own pinned loop.scope runs (else Producer's cross-agent standard). Any other loop's agent is its subject's. */
  readonly agent?: string;
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
/**
 * Where a step's wrote file lives: an absolute path as given; a root-relative `clossys/agents/...` or `.clossys/...`
 * path under the root; any other relative path under clossys/agents/. Agents name the candidate the submit verb printed
 * (clossys/agents/<agent>/<slot>/candidates/<name>), so both spellings hash the same file.
 */
export function wroteFile(root: string, file: string): string {
  if (file.startsWith(sep)) return file;
  if (file.startsWith("clossys/agents/") || file.startsWith(".clossys/")) return join(root, file);
  return join(agentsDir(root), file);
}
function ledgerPath(root: string, file: string): string {
  const absolute = wroteFile(root, file);
  const inAgents = relative(agentsDir(root), absolute);
  if (!inAgents.startsWith("..")) return inAgents.split(sep).join("/");
  return relative(root, absolute).split(sep).join("/");
}
const isFile = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
function wroteOf(root: string, files: readonly string[] = []): LedgerStep["wrote"] {
  return files.map(file => {
    const rel = ledgerPath(root, file);
    const absolute = wroteFile(root, file);
    // Every file the step wrote is hashed as it stands when the step ends; null only when it no longer exists.
    return { file: rel, sha256: isFile(absolute) ? sha256Hex(readFileSync(absolute)) : null };
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

const WORK_ENTRY = /^queue\.(change|fix)#(.+)$/;
/** A clossys.queue-entry/2 change or fix named `queue.<kind>#<id>`, when one reads as valid. */
function readWork(root: string, name: string): SlotRequest | undefined {
  const match = WORK_ENTRY.exec(name);
  if (!match || !REQUEST_ID.test(match[2]!)) return undefined;
  try {
    const request = readRequest(join(root, "clossys"), match[2]!);
    return workQueue(request.kind) === `queue.${match[1]}` ? request : undefined;
  } catch (error) {
    if (error instanceof RequestError) return undefined;
    throw error;
  }
}

/** The entry a run starts from (`--from`): a /2 change or fix, else a clossys.queue-entry/1 decision entry. */
interface FromEntry { readonly name: string; readonly queue: string; readonly id: string; readonly status: string; readonly about: string; readonly byOwner: boolean }
function readFrom(root: string, name: string): FromEntry | undefined {
  const work = readWork(root, name);
  if (work) return { name, queue: workQueue(work.kind), id: work.id, status: work.status, about: work.target, byOwner: work.createdBy.actor === "owner" };
  const entry = readEntry(root, name);
  return entry && { name: entryName(entry), queue: entry.queue, id: entry.id, status: entry.status, about: entry.subject.to, byOwner: entry.createdBy.actor === "owner" };
}

/** The trigger of a new run (flows.md 2): `--trigger`, else read from the loop, the slot and the entry it starts from. */
function triggerOf(loop: LoopName, input: StartInput, subject: SlotSubject | undefined, from: FromEntry | undefined): string {
  if (input.trigger) return input.trigger;
  if (loop === "loop.release") return "T8";
  if (loop === "loop.audit") return "T6";
  if (loop === "loop.cascade") return "T7";
  if (loop === "loop.fill") return from ? "T4" : "T2";
  // CREATE and CHOOSE with no entry: a dependant marked needs-refresh (T7), else the slot's starter fill (T2).
  if ((loop === "loop.create" || loop === "loop.choose") && !from) return subject?.slot.status === "needs-refresh" ? "T7" : "T2";
  // SLOT answers a need for a new L3 (T4), or the owner's feedback on a slot no agent holds (T5).
  if (loop === "loop.slot") return input.request && !from ? "T4" : "T5";
  if (loop === "loop.scope") return from ? "T6" : "T4";
  // The owner's own words (clossys feedback: a kind change from the owner, or a legacy queue.fix) are T5.
  if (from) return (from.queue === "queue.change" || from.queue === "queue.fix") && from.byOwner ? "T5" : "T6";
  return subject?.slot.status === "needs-refresh" ? "T7" : "T3";
}

export type StartPlan = { ok: true; state: RunState; loaded: LoadedLoop } | { ok: false; reason: string };

/**
 * The agent whose own loop a run runs (U9a): an agent loop's slot subject's agent, a request's owner (loop.slot), or
 * loop.scope's --agent. Undefined: the run runs the consumer's (or the package) Producer version. A named --agent must
 * be a content agent and, for a slot or request run, the subject's own.
 */
function runAgent(input: StartInput, subject: SlotSubject | undefined, request: SlotRequest | undefined): { ok: true; agent?: LoopAgent } | { ok: false; reason: string } {
  if (input.agent !== undefined && !isLoopAgent(input.agent)) return { ok: false, reason: `--agent ${JSON.stringify(input.agent)} is not a content agent (director, designer, writer, publisher)` };
  if (input.agent !== undefined && !isAgentLoop(input.loop)) return { ok: false, reason: `${input.loop} is no agent loop; it takes no --agent` };
  if (!isAgentLoop(input.loop)) return { ok: true };
  const of = subject ? subject.agent : request ? requestOwner(request) : undefined;
  if (input.agent !== undefined && of !== undefined && input.agent !== of) return { ok: false, reason: `--agent ${input.agent}: ${input.loop} runs ${of}'s loop (${subject ? refOf(subject) : `request ${request!.id}`})` };
  if (input.agent !== undefined && of === undefined && input.loop !== "loop.scope") return { ok: false, reason: `--agent names whose loop.scope runs; ${input.loop} runs its subject's agent's loop` };
  const agent = input.agent ?? of;
  return { ok: true, ...(agent !== undefined && isLoopAgent(agent) ? { agent } : {}) };
}

/** Checks the input and builds a new run's state. Writes nothing. */
export function planRun(root: string, input: StartInput, at: Iso): StartPlan {
  let load = loadLoopVersion(root, input.loop);
  if (!load.ok) return { ok: false, reason: load.reason };
  let version = load.loaded.content;
  const needs = LOOP_SUBJECT[input.loop];
  // B8: every id the caller hands in is checked before it reaches a path or an argv.
  if (input.slot !== undefined && !SLOT_REF.test(input.slot)) return { ok: false, reason: `--slot ${JSON.stringify(input.slot)} is not a slot ref (<agent>/<slot-id>)` };
  if (input.from !== undefined && !ENTRY_NAME.test(input.from)) return { ok: false, reason: `--from ${JSON.stringify(input.from)} is not a queue entry (queue.<pick|approve|clarify|change|fix>#<id>)` };
  if (input.publication !== undefined && !PUBLICATION_ID.test(input.publication)) return { ok: false, reason: `--publication ${JSON.stringify(input.publication)} is not a publication id` };
  if (input.trigger !== undefined && !TRIGGER_CODE.test(input.trigger)) return { ok: false, reason: `--trigger ${JSON.stringify(input.trigger)} is not a trigger (T1-T8)` };
  let from: FromEntry | undefined;
  if (input.from !== undefined) {
    from = readFrom(root, input.from);
    if (!from) return { ok: false, reason: `--from ${input.from}: no such queue entry` };
    if (from.status !== "open") return { ok: false, reason: `--from ${from.name} is ${from.status}; a run starts from an open entry` };
  }
  let subject: SlotSubject | undefined;
  if (needs === "slot") {
    const fromRef = from ? from.about.split("/").slice(0, 2).join("/") : undefined;
    // B6: an entry the run starts from (and closes when done) must be about the slot the run is for.
    if (input.slot !== undefined && fromRef !== undefined && fromRef !== input.slot) return { ok: false, reason: `--from ${from!.name} is about ${fromRef}, not --slot ${input.slot}` };
    const ref = input.slot ?? fromRef;
    if (!ref) return { ok: false, reason: `${input.loop} runs for one slot: --slot <agent>/<slot-id> or --from <entry>` };
    if (!SLOT_REF.test(ref)) return { ok: false, reason: `${ref} (from ${from!.name}) is not a slot ref` };
    const [agent, slotId] = ref.split("/") as [AgentId, string];
    subject = slotId ? readSubject(root, agent, slotId) : undefined;
    if (!subject) return { ok: false, reason: `${ref} is not a consumer slot (clossys/agents/${ref}/slot.json, slot/2)` };
  }
  let request: SlotRequest | undefined;
  if (input.request !== undefined) {
    if (needs !== "request") return { ok: false, reason: `${input.loop} takes no --request` };
    if (!REQUEST_ID.test(input.request)) return { ok: false, reason: `--request ${JSON.stringify(input.request)} is not a request id` };
    try { request = readRequest(join(root, "clossys"), input.request); } catch (error) { if (error instanceof RequestError) return { ok: false, reason: error.message }; throw error; }
    if (request.status !== "open") return { ok: false, reason: `--request ${input.request} is ${request.status}; a run answers an open request` };
  }
  if (needs === "request" && !request) return { ok: false, reason: `${input.loop} runs for one request: --request <id> (clossys request --list --open)` };
  // U9a: the run's agent runs its own pinned version of this loop when it holds one.
  const owner = runAgent(input, subject, request);
  if (!owner.ok) return owner;
  if (owner.agent !== undefined) {
    load = loadLoopVersion(root, input.loop, owner.agent);
    if (!load.ok) return { ok: false, reason: load.reason };
    version = load.loaded.content;
  }
  if (needs === "publication" && !input.publication) return { ok: false, reason: `${input.loop} runs for one publication: --publication <id>` };
  if (needs !== "slot" && input.slot) return { ok: false, reason: `${input.loop} takes no --slot` };
  if (needs !== "slot" && from) {
    const about = from.about;
    const own = input.publication ? `publisher/release.${input.publication}` : undefined;
    if (needs === "publication" && about !== own) return { ok: false, reason: `--from ${from.name} is about ${about}, not ${own ?? "a publication"}` };
  }
  const code = triggerOf(input.loop, input, subject, from);
  if (!LOOP_TRIGGERS[input.loop].includes(code)) return { ok: false, reason: `trigger ${code} does not start ${input.loop} (it answers ${LOOP_TRIGGERS[input.loop].join(", ")})` };
  if (!version.trigger.includes(code)) return { ok: false, reason: `${load.loaded.ref} does not answer trigger ${code} (it answers ${version.trigger.join(", ")})` };
  const fromRef: Ref | undefined = from ? { to: `producer/${from.queue}` as Ref["to"], record: from.id, rel: "raisedBy" } : undefined;
  const slug = `${loopStem(input.loop)}-${subject ? subject.slotId.replace(/\./g, "-") : request ? targetOf(request)!.need.replace(/[./]/g, "-") : input.publication ?? loopStem(input.loop)}`;
  const state: RunState = {
    schema: "clossys.loop-run/1",
    runId: uniqueRunId(root, input.loop, entryStamp(at), slug),
    loop: input.loop,
    version: { candidate: load.loaded.candidate, ref: load.loaded.ref, sha256: load.loaded.sha256, source: load.loaded.source },
    ...(subject ? { subject: { agent: subject.agent, slotId: subject.slotId } } : {}),
    ...(owner.agent !== undefined ? { agent: owner.agent } : {}),
    ...(request ? { request: request.id } : {}),
    ...(input.publication ? { publication: input.publication } : {}),
    trigger: { code, kind: TRIGGER_KINDS[code]!, ...(fromRef ? { ref: fromRef } : {}) },
    ...(from ? { from: from.name } : {}),
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
  // The same agent planRun resolved: the version the run started on is the one it resumes on.
  const load = loadLoopVersion(root, state.loop, state.agent ?? state.subject?.agent);
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

/** A request run's request, read fresh (its decision and proposal change as the run goes). */
function requestOf(ctx: { readonly root: string; readonly state: RunState }): SlotRequest | undefined {
  if (!ctx.state.request) return undefined;
  try { return readRequest(join(ctx.root, "clossys"), ctx.state.request); } catch (error) { if (error instanceof RequestError) return undefined; throw error; }
}
const requestOwner = (request: SlotRequest | undefined): AgentId | undefined => request ? targetOf(request)?.agent as AgentId | undefined : undefined;
/** What a request run asks about: the reused slot or the proposed leaf once the agent decided, else the need. */
const requestTo = (request: SlotRequest): string | undefined => {
  const target = targetOf(request)!;
  if (request.decision === "reuse" && request.reuse) return request.reuse;
  if (request.proposal) return `${target.agent}/${request.proposal.slot}`;
  // An L2 home (<agent>/<l1>/<l2>) names no slot yet: ask about the requester's slot.
  return !target.need.includes("/") ? `${target.agent}/${target.need}` : SLOT_REF.test(request.from) ? request.from : undefined;
};

function varsOf(ctx: Context, subject: SlotSubject | undefined): Record<string, string> {
  const request = requestOf(ctx);
  return {
    ...(subject ? slotVars(subject) : {}),
    ...(request ? { request: request.id, need: request.target, "owner of slot": requestOwner(request)!, agent: requestOwner(request)!, requester: request.from } : {}),
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
      // A release run's own slot is pinned last, by the ready-pin, and judged there by release.ready.
      const own = state.publication ? `publisher/release.${state.publication}` : undefined;
      const findings = checkPinsResolve(root).findings.filter(finding => finding.subject !== own);
      return findings.length ? { ok: false, why: `pins.resolve: ${findings.map(finding => `${finding.subject} ${finding.detail}`).join("; ")}` } : { ok: true };
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
    // The ready-pin rules themselves (gates green now, manifest shas, build digest, pins unchanged): release/ready.ts.
    const ready = checkReleaseReady(root, pub);
    if (ready.status === "fail") return { ok: false, why: `${RELEASE_READY}: ${ready.findings.map(row => `${row.subject} ${row.detail}`).join("; ")}` };
    return { ok: true };
  }
  if (name === REQUEST_CLOSED) {
    if (!state.request) return { ok: false, why: `${REQUEST_CLOSED}: the run has no request` };
    const request = requestOf(ctx);
    if (!request) return { ok: false, why: `${REQUEST_CLOSED}: clossys/agents/producer/queue.slot/entries/${state.request}.json does not read as a clossys.queue-entry/2 kind slot` };
    if (request.status !== "closed" || !request.link || !request.notified || !request.closed) return { ok: false, why: `${REQUEST_CLOSED}: ${request.id} is ${request.status}${request.link ? "" : ", with no link"}${request.notified ? "" : ", with no notify event"}` };
    const [agent, slotId] = request.link.split("/") as [AgentId, string];
    if (!existsSync(join(root, "clossys", "agents", agent, slotId, "slot.json"))) return { ok: false, why: `${REQUEST_CLOSED}: ${request.id} links ${request.link}, which is no consumer slot` };
    return { ok: true };
  }
  if (name === REQUESTS_FILED) {
    // The same demand diff `clossys request --scan` files from (records/request.ts slotlessNeeds).
    const unfiled = unfiledNeeds(join(root, "clossys"));
    return unfiled.length ? { ok: false, why: `${REQUESTS_FILED}: ${unfiled.length} slotless need(s) not filed: ${unfiled.slice(0, 5).map(need => `${need.from} -> ${need.to}${need.target ? "" : " (no owner)"}`).join("; ")}` } : { ok: true };
  }
  if (name === CANDIDATES_CERTIFIED) {
    if (!state.subject) return { ok: false, why: `${CANDIDATES_CERTIFIED}: the run has no slot` };
    const { agent, slotId } = state.subject;
    // The same judgement `clossys options <ref> --check` and check:slot-options make (constitution/pin-gate.ts).
    const judged = certifiedOptions(root, join(root, "clossys"), agent, slotId, state.startedAt);
    return judged.ok ? { ok: true } : { ok: false, why: `${CANDIDATES_CERTIFIED}: ${agent}/${slotId}: ${judged.why.join("; ")}` };
  }
  // No pin anywhere is stale or fails its re-verdict on the pinSet now (constitution/cascade.ts).
  if (name === CASCADE_CLEAN) return cascadeClean(root);
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
    const request = requestOf(ctx);
    if (!held && !whenMatches(step.when, subject, { owner: requestOwner(request), decision: request?.decision })) { state.cursor++; continue; }
    if (!held && ownerPicks(version, step, subject)) { state.cursor++; continue; }
    const vars = varsOf(ctx, subject);
    const filled = stepArgv(step.cli, vars);
    const decider = step.decider;

    if (decider.by === "human") {
      const result = await humanStep(ctx, step, subject, vars, filled.text);
      if (result) return result;
      continue;
    }

    let exit: Exit; let wrote: readonly string[] | undefined; let findings: readonly Finding[] = []; let raisedByStep = false; let ledgerDecider: Decider; let cli = filled.text;
    let ran: readonly string[] | undefined;
    if (decider.by === "agent") {
      const agent = decider.agent === OWNER_OF_SLOT ? subject?.agent ?? requestOwner(requestOf(ctx)) : decider.agent;
      if (!agent) return stop(ctx, `step ${step.id} names ${OWNER_OF_SLOT}, but ${state.loop} runs for no slot`, 2);
      let skill: string | undefined;
      try { skill = skillFor(root, decider.skill, agent); }
      catch (error) { if (error instanceof MissingSkillError) return stop(ctx, `step ${step.id}: ${error.message}`, 2); throw error; }
      const packet: AgentPacket = {
        runId: state.runId, step: step.id, agent, verb: decider.verb, tier: decider.tier, cli: filled.text, round: state.round,
        ...(skill ? { skill } : {}), ...(subject ? { ref: refOf(subject) } : {}), ...(state.from ? { from: state.from } : {}),
        ...(state.request ? { request: state.request } : {}),
      };
      // U9a fix round 4 (blind2 B1): an agent step of an agent loop is judged by what it changed, not only by what it
      // reports: the tree before it is kept in the run state while the run waits; a resume without it stops.
      // foundry-build-0048 U26 (r1 B1): Producer's standard version is judged the same way as an agent's own version.
      const ownLoop = isAgentLoop(state.loop);
      let before: TreeFiles | undefined;
      if (ownLoop) {
        if (held && state.waiting?.on === "agent") {
          before = keptSnapshot(state.agentSnapshot, step.id);
          if (before === undefined) {
            delete state.agentSnapshot;
            return stop(ctx, `step ${step.id}: the snapshot the run kept before agent:${agent} ran is missing or corrupt, so what the step wrote cannot be judged`, 2);
          }
        } else before = treeSnapshot(root, state.runId);
      }
      const outcome = await hooks.agent(packet);
      if (outcome === "wait") {
        state.status = "waiting"; state.waiting = { step: step.id, on: "agent" };
        if (before !== undefined) state.agentSnapshot = keepSnapshot(step.id, before);
        saveState(root, state);
        return { exitCode: 0, state, packet, message: `run ${state.runId}: step ${step.id} waits for agent:${agent} (${decider.verb}, ${decider.tier})` };
      }
      exit = outcome.exit; wrote = outcome.wrote; cli = outcome.cli ?? filled.text;
      ledgerDecider = { by: "agent", agent, verb: decider.verb, tier: decider.tier, model: outcome.model, ...(skill ? { skill } : {}) };
      delete state.agentSnapshot;
      let judgedWrote = wrote;
      if (before !== undefined) {
        // Every change the step made: a removal, an unreported write, or a ledger change that is not its own append.
        const reported = new Set((wrote ?? []).map(file => snapshotKey(root, wroteFile(root, file))));
        const current = isAgentLoop(state.loop) ? currentStandardOf(root, state.loop) : undefined;
        const judged = judgeSnapshot(root, before, treeSnapshot(root, state.runId), reported, step, agent, state.subject, current?.ok ? current.standard : undefined);
        if (judged.issues.length) {
          delete state.waiting;
          recordStep(ctx, step, ledgerDecider, cli, 1, wrote, vars);
          return stop(ctx, `step ${step.id} ${judged.issues.join("; ")}; ${state.version.ref} refuses it`, 1);
        }
        // The slot ledger is judged by its append rule above, never by the write allowlist.
        const appended = new Set(judged.appended);
        judgedWrote = wrote?.filter(file => !appended.has(snapshotKey(root, wroteFile(root, file))));
      }
      // U9a: an agent's own loop writes only what its step declares; anything else stops the run, whatever its exit.
      const stray = undeclaredWrites(root, state, step, judgedWrote, before);
      if (stray.length) {
        delete state.waiting;
        recordStep(ctx, step, ledgerDecider, cli, 1, wrote, vars);
        return stop(ctx, `step ${step.id} wrote ${stray.join(", ")}, which ${state.version.ref} does not declare it writes`, 1);
      }
    } else {
      ledgerDecider = { by: "code" };
      const builtIn = recordedBuiltIn(ctx, step, subject, filled);
      if (builtIn) {
        ({ exit, wrote } = builtIn);
        findings = builtIn.findings ?? [];
        for (const entry of builtIn.raised ?? []) state.raised.push(entryName(entry));
        raisedByStep = !!builtIn.raised?.length;
      }
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
    const result = await afterStep(ctx, step, recorded.exit, findings, subject, raisedByStep);
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
type BuiltIn = { exit: Exit; wrote: string[]; findings?: readonly Finding[]; raised?: readonly Raised[] };
function codeBuiltIn(ctx: Context, step: LoopStep, subject: SlotSubject | undefined): BuiltIn | undefined {
  const { root, state } = ctx;
  if (step.cli === "clossys check --route") {
    const raised = routeFindings(root, state.findings, iso(ctx.now()), state.loop, `found by ${state.loop} run ${state.runId}`);
    for (const entry of raised) state.raised.push(entryName(entry));
    return { exit: 0, wrote: raised.map(entry => `producer/${entry.queue}/entries/${entry.id}.json`) };
  }
  if (step.cli.includes("<dependants>")) {
    if (!subject) return { exit: 2, wrote: [] };
    const at = iso(ctx.now());
    const missing = subject.slot.refs.filter(ref => ref.rel === "consumedBy" && !readSubject(root, ref.to.split("/")[0] as AgentId, ref.to.split("/")[1] ?? ""));
    // loop.cascade runs because a repin upstream changed pinSets (T7); any other loop, when this run moved the pin.
    const repinned = state.loop === "loop.cascade" || pinSha(root, subject) !== state.startPin;
    const cascade = runCascade(root, at, { maxRounds: ctx.version.maxRounds, cause: subject, repinned });
    const raised: Raised[] = [];
    if (!cascade.converged) {
      const entry = raiseFor(ctx, subject, `${ctx.version.maxRounds} rounds of the cascade after ${refOf(subject)} did not reach a fixed point; still stale: ${cascade.stale.join(", ")}`, at, false);
      if (entry) raised.push(entry);
    }
    const gate = (step.checks ?? []).includes(CASCADE_CLEAN);
    if (!gate && cascade.findings.length) {
      // CHOOSE, FILL and REFINE: the run's own slot is done; each failing dependant goes to its owner as a kind fix.
      raised.push(...routeFindings(root, cascade.findings, at, `${state.loop} ${step.id}`, `${refOf(subject)} repinned (${state.loop} run ${state.runId})`));
    }
    const wrote = [...cascade.wrote, ...raised.map(entry => `producer/${entry.queue}/entries/${entry.id}.json`)];
    const failed = missing.length > 0 || (gate && (cascade.findings.length > 0 || !cascade.converged));
    return { exit: failed ? 1 : 0, wrote, ...(gate ? { findings: cascade.findings } : {}), raised };
  }
  return undefined;
}

/**
 * A built-in code step runs observed, like any traced step (pipeline/trace.ts): it appends one
 * clossys.pipeline-run/1 record to `.clossys/runs/<loop>.<step>.jsonl` with every file it read and
 * wrote and their sha256, so a loop's own writes (queue entries, slot status) are on the run record.
 */
function recordedBuiltIn(ctx: Context, step: LoopStep, subject: SlotSubject | undefined, filled: { readonly argv: readonly string[]; readonly text: string }): BuiltIn | undefined {
  const watch = observe();
  // Wall time, not ctx.now(): the run clock dates entries and pins, and a record must not move it.
  const start = new Date();
  let result: BuiltIn | undefined;
  try { result = codeBuiltIn(ctx, step, subject); }
  finally { watch.stop(); }
  if (!result) return undefined;
  // The step's own files are writes too: a queue entry is created through a file descriptor (openSync "wx"), which
  // the fs observer does not hook, so without this the record would list none of what route raised.
  for (const file of result.wrote) {
    const rel = ledgerPath(ctx.root, file);
    watch.observation.writes.add(rel.startsWith(".clossys") ? join(ctx.root, rel) : join(agentsDir(ctx.root), rel));
  }
  const argv = filled.argv[0] === "clossys" ? filled.argv.slice(1) : filled.argv;
  appendRecord(ctx.root, buildRecord({ root: ctx.root, step: `${ctx.state.loop}.${step.id}`, invocation: invocationOf(argv), argv, start, end: new Date(), exit: result.exit, observation: watch.observation }));
  return result;
}

/** Whether a step is the code route step a failing step with no `onFail` hands its findings to (flows.md F6). */
export const routesFindings = (next: Pick<LoopStep, "cli" | "decider"> | undefined): boolean => next?.cli === "clossys check --route" && next.decider.by === "code";

/**
 * U9a: a failing step hands its findings to the route step after it only as Producer's standard has it. A Producer
 * version is the standard; an agent's own version hands on only where the standard runs the same route step right after
 * the same failing step, so an agent cannot add or move a route step to let a failed required step pass.
 */
export function routeHandsOn(state: Pick<RunState, "loop" | "version">, step: LoopStep, next: LoopStep, root?: string): boolean {
  if (state.version.ref.startsWith("producer/") || !isAgentLoop(state.loop)) return true;
  const standard = currentStandardOf(root, state.loop);
  if (!standard.ok) return false;
  const steps = standard.standard.steps;
  const at = steps.findIndex(each => each.id === step.id);
  const after = at < 0 ? undefined : steps[at + 1];
  return after !== undefined && after.id === next.id && after.cli === next.cli && after.decider.by === "code" && !steps[at]!.onFail;
}

/**
 * U9a fix round 3: a file an agent step reported writing, as `agentWriteClass` judges it: its segments in the ledger's
 * agents-relative form (`clossys/agents/` dropped, `.clossys/...` kept), or why it is refused. Only the root's own real
 * path is resolved (a temp root under a linked `/var`); every component below it is read with lstat and a symlink is
 * refused, never followed. A file that exists must be a regular file with one link: a hard link to a Producer record
 * (a pin, a slot record) would let a candidate write change it, so it is refused, as are directories and fifos.
 */
export function agentWriteRef(root: string, file: string): { segments: string[] } | { refused: string } {
  let base: string;
  try { base = realpathSync(root); } catch { return { refused: `${file}: the root ${root} cannot be resolved` }; }
  const rel = relative(root, wroteFile(root, file));
  const parts = rel.split(sep).filter(part => part !== "");
  let at = base;
  for (let index = 0; index < parts.length; index++) {
    at = join(at, parts[index]!);
    let stat;
    try { stat = lstatSync(at, { throwIfNoEntry: false }); } catch { return { refused: `${file}: ${at} cannot be read` }; }
    if (stat === undefined) break;
    if (stat.isSymbolicLink()) return { refused: `${file}: ${at} is a symlink` };
    if (index === parts.length - 1 && !(stat.isFile() && stat.nlink === 1)) return { refused: `${file}: ${at} is not a regular file with one link` };
  }
  const segments = parts[0] === "clossys" && parts[1] === "agents" ? parts.slice(2) : parts;
  // U9a fix round 4 (blind1 #4): nothing an agent writes under clossys/agents/ is a dot path (a hidden slot or file).
  if (segments !== parts && segments.some(segment => segment.startsWith("."))) return { refused: `${file}: a dot path under clossys/agents/` };
  return { segments };
}

/**
 * U9a fix round 3, U9 (sweep N1), U9 fix r1 (review-u9-blind1 #1), U7 r5: a slot request an agent step raised itself,
 * exactly the entry `clossys request --from <agent>/<slot> --by <agent>` (or its `--scan`) writes for that agent now: a
 * schema-valid `clossys.queue-entry/2` kind slot entry named by its file that the request verb's own validator accepts
 * (records/request.ts freshRaiseIssues, agentRaiseIssues: from one of the agent's own placed slots citing the target,
 * never `owner`; the target not placed; the verb's draft rebuilt from the entry's fields and equal to it, so its id,
 * refs, timestamps, its raised and routed events, route and options, its code actor and nothing a later step writes; no
 * other open entry raising the same target from the same slot). Any other entry (an owner answer queue's, another
 * agent's request, an owner-origin ask, one already checked, decided, answered or closed, or a forged or rewritten
 * chain) is Producer's.
 */
function ownNewRequest(root: string, file: string, agent: LoopAgent): boolean {
  try {
    const path = wroteFile(root, file);
    const doc = JSON.parse(readFileSync(path, "utf8")) as { id?: unknown };
    if (!isContentAgent(agent) || basename(path) !== `${String(doc.id)}.json`) return false;
    return !freshRaiseIssues(join(root, "clossys"), doc, agent).length;
  } catch {
    return false;
  }
}

/**
 * U9a: the files an agent step of an agent's own loop version reported writing that it may not write: outside the root,
 * through `..`, through a symlink or a hard link (`agentWriteRef`), a Producer-owned file (anything but what the
 * standard's own step of that id declares, filled for the run, or the agent write allowlist `agentWriteClass`; a slot
 * request under the allowlist must be a new one the agent raised), or matching none of the step's `writes` (with
 * `<slot>` the run's own slot). Producer's standard version is judged the same way (foundry-build-0048 U26 r1 B1: its
 * agent steps write only what they declare); empty only for a Producer version of a loop that is not an agent loop.
 * The runner judges the files the step reports (the resumer's `--wrote` list or the code hook's outcome) and refuses
 * symlinked and hard-linked ones; a write the step does not report is caught by the snapshot diff (agent-snapshot.ts) before this runs.
 *
 * U9a fix round 4 (blind1 B1): a slot request and a candidate are create-only: one that was in `before` (the snapshot
 * taken before the step) is refused, unless the standard's own step names that exact file (loop.slot's decide step
 * answers its own `<request>` entry). Without a snapshot every write is refused (fail closed).
 */
export function undeclaredWrites(root: string, state: RunState, step: LoopStep, wrote: readonly string[] | undefined, before: TreeFiles | undefined): string[] {
  if ((state.version.ref.startsWith("producer/") && !isAgentLoop(state.loop)) || step.decider.by !== "agent" || !wrote?.length) return [];
  const agent = state.agent ?? state.subject?.agent;
  if (agent === undefined || !isLoopAgent(agent) || before === undefined) return [...wrote];
  const slot = state.subject ? `${state.subject.agent}/${state.subject.slotId}` : undefined;
  const fill = (write: string): string[] | undefined => {
    let path = write;
    if (slot) path = path.replace(/^(clossys\/agents\/)?<slot>(?=\/|$)/, `$1${slot}`).replaceAll("<slot-id>", state.subject!.slotId);
    if (state.request) path = path.replaceAll("<request>", state.request);
    return pathPattern(path, agent);
  };
  const defined = (pattern: string[] | undefined): pattern is string[] => pattern !== undefined;
  const declared = (step.writes ?? []).map(fill).filter(defined);
  const standard = isAgentLoop(state.loop) ? currentStandardOf(root, state.loop) : undefined;
  const own = (standard?.ok ? standardOwnWrites(standard.standard, step, agent) : []).map(fill).filter(defined);
  const literal = (pattern: readonly string[]) => pattern.every(segment => !segment.includes("*"));
  return wrote.filter(file => {
    if (file.split(/[\\/]/).includes("..")) return true;
    const absolute = wroteFile(root, file);
    if (relative(root, absolute).split(sep)[0] === "..") return true;
    const ref = agentWriteRef(root, file);
    if ("refused" in ref) return true;
    const { segments } = ref;
    const existed = snapshotKey(root, absolute) in before;
    const kind = agentWriteClass(segments, agent);
    if ((kind === "queue-slot" || kind === "candidate") && existed && !own.some(pattern => literal(pattern) && patternsMeet(pattern, segments))) return true;
    // U9 (sweep N1): a new slot request is judged by its shape also where the standard step's wildcard write
    // (`producer/queue.slot/entries/*`, the scope steps) names it; only a step naming that exact entry is exempt.
    if (kind === "queue-slot" && !own.some(pattern => literal(pattern) && patternsMeet(pattern, segments)) && !ownNewRequest(root, file, agent)) return true;
    if (!own.some(pattern => patternsMeet(pattern, segments)) && kind === undefined) return true;
    return !declared.some(pattern => patternsMeet(pattern, segments));
  });
}

/** onFail and exit 2 (null: go on). */
async function afterStep(ctx: Context, step: LoopStep, exit: Exit, findings: readonly Finding[], subject: SlotSubject | undefined, raisedByStep = false): Promise<RunResult | null> {
  const { root, state, version } = ctx;
  if (exit === 0) { state.cursor++; saveState(root, state); return null; }
  if (exit === 2) return stop(ctx, `step ${step.id} could not run (exit 2)`, 2);
  const next = version.steps[state.cursor + 1];
  if (!step.onFail) {
    // A failing check whose next step routes findings hands them on (flows.md F6: route after check).
    if (routesFindings(next) && routeHandsOn(state, step, next!, root)) { state.cursor++; saveState(root, state); return null; }
    return stop(ctx, `step ${step.id} failed`, 1);
  }
  const at = iso(ctx.now());
  const label = `${state.loop} ${step.id}`;
  if (step.onFail.then !== "retry") {
    // A step that raised its own entries (the cascade's queue.clarify) needs no fallback entry.
    // The cascade's breakage is the repin it re-verdicts after (its subject); any other step's is the run step itself.
    const cause = state.loop === "loop.cascade" && subject ? `${refOf(subject)} repinned (${state.loop} run ${state.runId} step ${step.id})`
      : `${state.loop} run ${state.runId} step ${step.id} failed`;
    const ask = `${label} failed${state.publication ? ` for ${state.publication}` : ""}`;
    const raised: Raised[] = findings.length ? routeFindings(root, findings, at, label, cause) : raisedByStep ? []
      : [step.onFail.raise === "queue.clarify" ? raiseFor(ctx, subject, ask, at) : raiseStepFix(ctx, step, subject, ask, at)].filter((e): e is Raised => e !== undefined);
    for (const entry of raised) state.raised.push(entryName(entry));
    const names = raised.map(entryName);
    return stop(ctx, `${step.id} failed; ${names.length ? `raised ${names.join(", ")}; ` : ""}${step.onFail.then} runs from ${names[0] ?? "the open entry"}`, 1);
  }
  if (step.onFail.raise === "queue.clarify") return waitOnClarify(ctx, step, subject);
  state.round++;
  if (state.round > version.maxRounds) {
    const entry = raiseFor(ctx, subject, `${version.maxRounds} rounds of ${state.loop} did not pass ${step.id}${subject ? ` for ${refOf(subject)}` : ""}`, at, false);
    if (entry) state.raised.push(entryName(entry));
    return stop(ctx, `${step.id} failed ${version.maxRounds} rounds (maxRounds); raised ${entry ? entryName(entry) : "nothing"}`, 1);
  }
  const fix = raiseStepFix(ctx, step, subject, `${label} failed${subject ? ` for ${refOf(subject)}` : ""}; round ${state.round} of ${version.maxRounds}`, at, state.round - 1);
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

/** The run's own subject as a ref: its slot, else its publication's release slot. */
function subjectRef(ctx: Context, subject: SlotSubject | undefined): string | undefined {
  return subject ? refOf(subject) : ctx.state.publication ? `publisher/release.${ctx.state.publication}` : undefined;
}

/** The owner's queue.clarify about the run's subject. */
function raiseOf(ctx: Context, subject: SlotSubject | undefined, ask: string): Raise | undefined {
  const to = subjectRef(ctx, subject);
  if (!to) return undefined;
  return { queue: "queue.clarify", subject: { to: to as Ref["to"], rel: "input" }, decider: "owner", ask, slug: to.split("/")[1]! };
}

function raiseFor(ctx: Context, subject: SlotSubject | undefined, ask: string, at: Iso, dedupe = true): QueueEntry | undefined {
  const raise = raiseOf(ctx, subject, ask);
  return raise ? raiseEntry(ctx.root, raise, at, dedupe).entry : undefined;
}

/**
 * The check a failed step's fix names (foundry-build-0048 Q10): the loop's exit check when Producer re-runs it on the
 * slot (FIX_CHECKS: the fix then closes fixed when the run ends with it passing), else the step's first failing check,
 * else `<loop>.<step>`.
 */
function stepFixCheck(ctx: Context, step: LoopStep): string {
  const exit = EXIT_CHECKS[ctx.state.loop].find(check => FIX_CHECKS.includes(check));
  if (exit) return exit;
  const failed = step.checks.map(check => fillNames(check, { ...slotVarsOf(ctx), ...ctx.state.vars }).text).find(name => ctx.state.checks[name] === "fail");
  return failed ?? `${ctx.state.loop}.${step.id}`;
}
const slotVarsOf = (ctx: Context): Record<string, string> => {
  const subject = subjectOf(ctx);
  return subject ? slotVars(subject) : {};
};

/**
 * A failed step's breakage as a kind fix on the run's slot (or publication), from that slot itself, with its check,
 * the step's failing checks as findings and the run step as its cause. A subject the store takes no fix on (none, or no
 * placed slot) asks the owner instead. `round` is the round that failed (a retry raises after the round count moved on).
 */
function raiseStepFix(ctx: Context, step: LoopStep, subject: SlotSubject | undefined, ask: string, at: Iso, round = ctx.state.round): Raised | undefined {
  const target = subjectRef(ctx, subject);
  if (!target) return undefined;
  const failing = step.checks.map(check => fillNames(check, { ...slotVarsOf(ctx), ...ctx.state.vars }).text).filter(name => ctx.state.checks[name] === "fail");
  try {
    return raisedOf(raiseFix(ctx.root, {
      target, check: stepFixCheck(ctx, step), why: ask,
      findings: [`${ask}${failing.length ? `: ${failing.join(", ")} failed` : ""}`],
      cause: `${ctx.state.loop} run ${ctx.state.runId} step ${step.id} round ${round}`,
    }, at).request);
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    return raiseFor(ctx, subject, `${ask} (no fix entry: ${error.message})`, at);
  }
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
  const raise = raiseOf(ctx, subject, `${state.loop} ${step.id} failed${subject ? ` for ${refOf(subject)}` : ""}: what should it do?`);
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
  const request = requestOf(ctx);
  const to = subject ? refOf(subject) : state.publication ? `publisher/release.${state.publication}` : request ? requestTo(request) : undefined;
  if (!to) return stop(ctx, `step ${step.id} needs a slot, a request or a publication to ask about`, 2);
  let options: QueueEntry["options"];
  let refs: Ref[] | undefined;
  let fallback: string | null = null;
  if (decider.raise === "queue.pick") {
    const names = subject ? slotCandidates(root, subject) : [];
    if (!names.length) return stop(ctx, `step ${step.id}: ${to} has no candidates to pick from`, 1);
    options = names.map(name => ({ id: name, candidate: name, summary: `${to}/${name}` }));
  } else if (decider.raise === "queue.approve") {
    const release = state.loop === "loop.release";
    // The sign-off names the one manifest it approves, by name and sha256 (release/ready.ts answerIssues).
    const manifest = release ? state.vars.manifest : undefined;
    const file = manifest ? join(root, "clossys", "agents", to, "candidates", manifest) : undefined;
    if (manifest && file && existsSync(file)) refs = [{ to: `${to}/${manifest}` as Ref["to"], sha256: sha256Hex(readFileSync(file)) as Ref["sha256"], rel: "input" }];
    options = request
      ? [{ id: "approve", summary: request.decision === "create" ? `sign the new leaf ${to} under ${request.proposal?.under ?? "its L2"} (request ${request.id})` : `sign the ${request.decision ?? "pending"} answer to request ${request.id}` }, { id: "reject", summary: "leave the request open" }]
      : release
      ? [{ id: "ready", ...(manifest ? { candidate: manifest as NonNullable<QueueEntry["options"]>[number]["candidate"] } : {}), summary: `mark ${manifest ?? "the manifest"} ready` }, { id: "not-ready", summary: "keep the current ready pin" }]
      : [{ id: "approve", summary: `confirm the agent's pick for ${to}` }, { id: "reject", summary: "keep looking" }];
    fallback = release ? "not-ready" : null;
  }
  const entry = raiseOnce(ctx, step.id, {
    queue: decider.raise, subject: { to: to as Ref["to"], rel: "input" }, decider: "owner", ask: `${step.does} (${to})`,
    slug: to.split("/")[1]!, default: fallback, ...(options ? { options } : {}), ...(refs ? { refs } : {}),
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
  // The entries this run answers: the one it started from and the fixes it raised on the way (answered by the slot).
  // A /2 change or fix its slot's agent holds closes through the closure rule (closeWork: the fix's check and the
  // requester check re-run); one the closure rule hands to the owner (a claim on a check Producer cannot re-run) or
  // refuses stays open and the outcome says so. An owner's clarify is the owner's to answer (B6).
  const open: string[] = [];
  if (subject) {
    for (const name of [state.from, ...state.raised].filter((n): n is string => n !== undefined)) {
      const work = readWork(root, name);
      if (work) {
        if (work.status !== "open" || work.target !== refOf(subject) || !isContentAgent(work.assignee)) continue;
        try {
          const closed = closeWork(join(root, "clossys"), work.id, { by: work.assignee, at: iso(ctx.now()), outcome: work.kind === "fix" ? "fixed" : "changed", result: refOf(subject) });
          if (closed.status === "closed") state.refs.push({ to: `producer/${workQueue(work.kind)}` as Ref["to"], record: work.id, rel: "answers" });
          else open.push(`${name} awaits the owner`);
        } catch (error) {
          if (!(error instanceof RequestError)) throw error;
          open.push(`${name} stays open: ${error.message}`);
        }
        continue;
      }
      const entry = readEntry(root, name);
      if (!entry || entry.status !== "open" || entry.queue !== "queue.fix" || !entry.decider.startsWith("agent:")) continue;
      // A fix the cascade routed to a dependant's owner is that slot's to close, not this run's.
      if (entry.subject.to !== refOf(subject) && entry.ask.includes(CASCADE_REVERDICT)) continue;
      answerQueueEntry(root, { entry: name, by: RUN_BY, answer: `${state.loop} ${state.runId} done`, answers: refOf(subject) }, ctx.now());
      state.refs.push({ to: `producer/${entry.queue}` as Ref["to"], record: entry.id, rel: "answers" });
    }
  }
  const outcome = state.loop === "loop.audit"
    ? (state.raised.length ? `raised ${state.raised.join(", ")}` : "no new entry")
    : ready ? `${state.publication ?? "release"} ${state.vars.manifest ?? ""} pinned ready`.replace(/\s+/g, " ").trim()
      : `${subject ? refOf(subject) : state.loop} done${pinSha(root, state.subject) ? `; pinned ${resolveSlotCandidate(root, state)}` : ""}`;
  return writeLedger(ctx, ready ? "pinned-ready" : "done", open.length ? `${outcome}; ${open.join("; ")}` : outcome, 0);
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
