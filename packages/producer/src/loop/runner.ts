/**
 * The loop runner behind `clossys run loop.<name>` (producer.md 10, flows.md 3-4).
 *
 * One step at a time, in the order of the version that runs (the consumer pin, else package v1; version.ts):
 *
 * - a step whose `when` does not match the slot is skipped and left out of the ledger;
 * - a code step runs through `hooks.code` (the CLI runs the verb); three are built in: `clossys settle <rule>` settles
 *   the fixed-rule part of the agent steps after it (foundry-build-0048 DET-STEPS, see settleStep), `clossys check --route` routes the
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
 * Run state is kept in `clossys/.state/runs/loops/<runId>.json`; resuming never runs a finished step again. Every run that
 * ends (done, stopped or pinned-ready) writes one ledger entry, `clossys/agents/producer/ledger.<loop>/entries/<runId>.json`.
 */
import { isStateRel, refuseLegacyState, statePath, stateRel } from "../engine/state-dir.js";
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, writeSync, readFileSync, realpathSync, renameSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { appendRecord, buildRecord, invocationOf, observe } from "../pipeline/trace.js";
import { basename, dirname, join, relative, sep } from "node:path";
import { checkPinsResolve, resolveAll } from "../check/pins-resolve.js";
import { IA_ORPHANS, runIaOrphans } from "../check/ia-orphans.js";
import { RECORDS_COMPUTED_MATCH, runRecordsComputedMatch } from "../check/records-computed-match.js";
import { answerQueueEntry } from "../queue/answer.js";
import { entryStamp, findQueueEntry, listQueueEntryFiles, readQueueEntry, slugOf } from "../queue/entry.js";
import { sha256Hex } from "../records/hash.js";
import { CODE_SCORECARD, OWNER_BASES, buildPin, confirmableBasis, cliActor, pinIssues, pinPath, writePinDoc } from "../records/pin.js";
import { mergeRefs, readPinFile } from "../records/pin-map.js";
import { isRecordSlot, resolveSlot, slotRecords, type Resolution } from "../records/resolve.js";
import { readSlotEntry } from "../records/slots.js";
import { validateAgainst } from "../records/schema.js";
import { recordSchema, writeSlot } from "../records/slot.js";
import { SLOT_LOCK, withDirLock, writeCandidate, writeTargetConfirm, writeTargetDecision, type WriteGuard } from "../records/slot-write.js";
import { CODE_ADOPT, CODE_ADOPT_CLI, CODE_ADOPT_RUNG, CODE_ADOPT_SKILL, REFERENCE_MANIFEST, codeAdoptSlotRefusal, stockItemOf } from "../records/code-adopt.js";
import type { SlotAgent } from "../records/slot-model/index.js";
import "../constitution/guard.js"; // registers the write guard's runner (the confirm and revert writes are guarded)
import type { AgentId, Decider, DeciderVerb, Iso, LedgerEntry, LoopStep, LoopVersion, QueueEntry, Ref, Tier } from "../records/types.js";
import { RUN_BY, RUN_CLI, entryName, producerVersion, raiseEntry, raiseFix, raisedOf, routeFindings, type Finding, type Raise, type Raised } from "./route.js";
import { dependantsOf, fillNames, fillQueue, MissingSkillError, nextFillSlot, readSubject, refOf, skillFor, slotCandidates, slotVars, stepArgv, unpinnedLeaves, whenMatches, type SlotSubject } from "./slots.js";
import {
  AGENT_PICK_VERB, CANDIDATES_CERTIFIED, CASCADE_CLEAN, REQUEST_CLOSED, REQUESTS_FILED, CANDIDATE_NAME, ENTRY_NAME, EXIT_CHECKS, LOOP_SUBJECT, LOOP_TRIGGERS, OWNER_OF_SLOT, OWNER_PICK_RAISE, PUBLICATION_ID, RELEASE_READY, RUN_ID,
  SLOT_REF, TRIGGER_CODE, TRIGGER_KINDS, VERIFIED_CHECKS, ledgerOf, loopStem, type LoopName,
} from "./names.js";
import { loadLoopVersion, type LoadedLoop } from "./version.js";
import { agentWriteClass, currentStandardOf, isAgentLoop, isLoopAgent, pathPattern, patternsMeet, standardOwnWrites, type LoopAgent } from "./agent-loops.js";
import { judgeSnapshot, keepSnapshot, keptSnapshot, keptTexts, snapshotKey, stepEntryTexts, treeSnapshot, type AgentSnapshot, type TreeFiles, type TreeTexts } from "./agent-snapshot.js";
import { checkReleaseReady } from "../release/ready.js";
import { certifiedOptions, pinGate } from "../constitution/pin-gate.js";
import { codeSlotRefusals, scorecardTopRefusal } from "./code-pin.js";
import { pinTargetSlot } from "../cli/pin.js";
import { agentWorkRaiseIssues, closeWork, decideRequest, exactReuseOf, freshRaiseIssues, isContentAgent, readRequest, REQUEST_ID, RequestError, targetOf, unfiledNeeds, workQueue, type SlotRequest } from "../records/request.js";
import { FIX_CHECKS } from "../queue/requester-check.js";
import { handlerMismatch } from "../queue/routing.js";
import { cascadeClean, runCascade } from "./cascade.js";
import { CASCADE_REVERDICT } from "../constitution/cascade.js";
import { inputsOf, readEventLines } from "../engine/chain.js";
import { commitEvent } from "../engine/log.js";

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
  /**
   * The constitution guard the runner's own pin writes run (B5: the owner's confirm on a confirm step, a reject's
   * put-back): omitted, the installed guard, as `clossys pin` runs it. A test whose stub world is no constitution-clean
   * consumer substitutes a registry, as runPinCli's `guard` parameter takes one.
   */
  readonly guard?: WriteGuard;
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
  /** The T1 init's fill queue (FILL-PRELUDE D1): the `<agent>/<slot-id>` refs its run.queue events name, in chain order. */
  queue?: string[];
  waiting?: Waiting;
  /** An owner entry about to be raised: saved before the raise, so a resume adopts the entry instead of raising it twice (B9). */
  pendingRaise?: { step: string; queue: string; at: Iso; then?: "retry" };
  /**
   * U9a fix round 4: what `clossys/` (its records and its state folder, clossys/.state/) held right before an agent step of an agent's own loop was handed
   * to the agent, kept while the run waits on it; the step's answer is judged against it (agent-snapshot.ts).
   */
  agentSnapshot?: AgentSnapshot;
  /** Step checks the verb did not run (B7); named in the outcome. */
  notRun?: string[];
  /**
   * foundry-build-0048 DET-STEPS: the agent steps a `clossys settle` code step settled, each with the settle step's id;
   * an agent step named here is skipped (no packet), and its settle record is `clossys/.state/runs/loops/<runId>.settle/<step>.json`.
   * A retry back to a settled create step (a code adopt that failed its check) clears it: the agent creates.
   */
  settled?: Record<string, string>;
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
export const runsDir = (root: string): string => statePath(root, "runs", "loops");
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
  refuseLegacyState(root);
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
  refuseLegacyState(root);
  const file = runStatePath(root, state.runId);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temp, file);
  logRun(root, "run.state", state, [file]);
}
/** The engine event of a run record (engine.md "Writers"): subject `loop:<loop>/<run id>`, by the run CLI. */
function logRun(root: string, kind: string, state: Pick<RunState, "loop" | "runId">, files: readonly string[]): void {
  commitEvent(root, { actor: `code:${RUN_CLI}`, kind, subject: `loop:${state.loop}/${state.runId}`, inputs: inputsOf(root, files) });
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
 * Where a step's wrote file lives: an absolute path as given; a root-relative `clossys/agents/...` or state-folder
 * (`clossys/.state/...`)
 * path under the root; any other relative path under clossys/agents/. Agents name the candidate the submit verb printed
 * (clossys/agents/<agent>/<slot>/candidates/<name>), so both spellings hash the same file.
 */
export function wroteFile(root: string, file: string): string {
  if (file.startsWith(sep)) return file;
  if (file.startsWith("clossys/agents/") || isStateRel(file)) return join(root, file);
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
    // LOOP-STEPS: a run answers only an entry routed to its loop (the handler skill's "never answer an entry routed elsewhere").
    const mismatch = handlerMismatch(input.loop, request.kind, request.route);
    if (mismatch) return { ok: false, reason: `HandlerMismatchError: --request ${input.request}: ${mismatch}` };
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
  if (!state) return { exitCode: 2, message: `run: no run ${runId} in ${stateRel("runs", "loops")}/` };
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

/**
 * The agent an agent step runs as: its decider's agent, or for `<owner of slot>` the run slot's owner (else the run
 * request's target owner). The packet, the snapshot judgement and the write allowlist all judge the step as this agent,
 * never as the run's `--agent` (foundry-build-0048 U26: a cross-agent Producer standard, loop.scope, runs one step per agent).
 */
export function stepAgentOf(root: string, state: RunState, step: Pick<LoopStep, "decider">): AgentId | undefined {
  if (step.decider.by !== "agent") return undefined;
  return step.decider.agent === OWNER_OF_SLOT ? state.subject?.agent ?? requestOwner(requestOf({ root, state })) : step.decider.agent;
}
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

/**
 * B1: an agent pick step does not run for a slot an owner `queue.pick` step of this version picks, and neither does
 * the code step that would settle it (`clossys settle pick`): the owner's pick is never code's to score.
 */
function ownerPicks(version: LoopVersion, step: LoopStep, subject: SlotSubject | undefined): boolean {
  const scores = step.decider.by === "code" && SETTLE_CLI.exec(step.cli)?.[1] === "pick";
  if (!scores && (step.decider.by !== "agent" || step.decider.verb !== AGENT_PICK_VERB)) return false;
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
    // DET-STEPS: an agent step a settle code step settled by its fixed rule runs no agent (the settle record says why).
    if (!held && step.decider.by === "agent" && state.settled?.[step.id] !== undefined) { state.cursor++; continue; }
    const vars = varsOf(ctx, subject);
    const filled = stepArgv(step.cli, vars);
    const decider = step.decider;

    if (decider.by === "human") {
      const result = await humanStep(ctx, step, subject, vars, filled.text);
      if (result) return result;
      continue;
    }

    let exit: Exit; let wrote: readonly string[] | undefined; let findings: readonly Finding[] = []; let raisedByStep = false; let ledgerDecider: Decider; let cli = filled.text;
    let failedWhy: string | undefined;
    let ran: readonly string[] | undefined; let couldNot: string | undefined;
    /** LOOP-STEPS: the upstream requests this agent step raised through its skill's own verb (judged by stepRaises). */
    let raisedHere: string[] = [];
    if (decider.by === "agent") {
      const agent = stepAgentOf(root, state, step);
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
      let texts: TreeTexts | undefined;
      if (ownLoop) {
        if (held && state.waiting?.on === "agent") {
          before = keptSnapshot(state.agentSnapshot, step.id);
          texts = before === undefined ? undefined : keptTexts(state.agentSnapshot, before);
          if (before === undefined || texts === undefined) {
            delete state.agentSnapshot;
            return stop(ctx, `step ${step.id}: the snapshot the run kept before agent:${agent} ran is missing or corrupt, so what the step wrote cannot be judged`, 2);
          }
        } else {
          before = treeSnapshot(root, state.runId);
          // LOOP-STEPS: the before bytes of the queue entries the step names exactly, so a second write of one by the
          // step's own verbs (the skill's --check, then --decide) is judged against the states it passed through.
          texts = stepEntryTexts(root, before, stepEntryKeys(state, step));
        }
      }
      const outcome = await hooks.agent(packet);
      if (outcome === "wait") {
        state.status = "waiting"; state.waiting = { step: step.id, on: "agent" };
        if (before !== undefined) state.agentSnapshot = keepSnapshot(step.id, before, texts);
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
        // LOOP-STEPS: an upstream request a create step raised is judged by the request verb's own rebuilt entry
        // (stepRaises), never by the write allowlist; the log's request.create must name exactly an accepted one.
        const raises = decider.verb === "create-candidates" ? stepRaises(root, state, agent, wrote, before) : undefined;
        if (raises?.issues.length) {
          delete state.waiting;
          recordStep(ctx, step, ledgerDecider, cli, 1, wrote, vars);
          return stop(ctx, `step ${step.id} raised ${raises.issues.join("; ")}; ${state.version.ref} refuses it`, 1);
        }
        const judged = judgeSnapshot(root, before, treeSnapshot(root, state.runId), reported, step, agent, state.subject, current?.ok ? current.standard : undefined, state.runId, texts, new Set(raises?.keys ?? []));
        if (judged.issues.length) {
          delete state.waiting;
          recordStep(ctx, step, ledgerDecider, cli, 1, wrote, vars);
          return stop(ctx, `step ${step.id} ${judged.issues.join("; ")}; ${state.version.ref} refuses it`, 1);
        }
        // The slot ledger is judged by its append rule above, never by the write allowlist.
        const appended = new Set(judged.appended);
        judgedWrote = wrote?.filter(file => !appended.has(snapshotKey(root, wroteFile(root, file))));
        // The accepted raises leave the write allowlist; any other queue entry still goes to it and is refused.
        if (raises) {
          const keys = new Set(raises.keys);
          judgedWrote = judgedWrote?.filter(file => !keys.has(snapshotKey(root, wroteFile(root, file))));
          raisedHere = raises.names;
        }
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
        couldNot = builtIn.why;
        failedWhy = builtIn.failed;
      }
      else if (filled.unfilled.length) { exit = 2; wrote = []; }
      else {
        const filedBefore = LOOP_SUBJECT[state.loop] === "none" ? declaredQueueEntries(root, step) : undefined;
        const outcome = await hooks.code({ runId: state.runId, step: step.id, cli: filled.text, argv: filled.argv, ...(subject ? { ref: refOf(subject) } : {}), ...(state.publication ? { publication: state.publication } : {}) });
        exit = outcome.exit; wrote = outcome.wrote; findings = outcome.findings ?? []; ran = outcome.ran;
        // GF2 fix round 1: a subject-less run (loop.scope, loop.audit) counts the entries its code step filed in the
        // queue folders the step declares (the audit interview's queue.slot and queue.change), so its outcome is true.
        if (filedBefore) for (const name of declaredQueueEntries(root, step)) if (!filedBefore.has(name) && !state.raised.includes(name)) state.raised.push(name);
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
    if (recorded.exit === 2 && couldNot) return stop(ctx, `step ${step.id} could not run: ${couldNot}`, 2);
    for (const name of raisedHere) if (!state.raised.includes(name)) state.raised.push(name);
    // LOOP-STEPS: a create step that could not make its candidates and asked upstream parks on that request; the run
    // resumes the step once it closes (readRetry), never stops on it.
    if (raisedHere.length && recorded.exit !== 0) return waitOnRaised(ctx, step, raisedHere[0]!);
    if (recorded.why && !step.onFail) return stop(ctx, `step ${step.id} failed: ${recorded.why}`, 1);
    const result = await afterStep(ctx, step, recorded.exit, findings, subject, raisedByStep, recorded.why ?? (recorded.exit === 1 ? failedWhy : undefined));
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

/** The code steps the runner runs itself. */
type BuiltIn = { exit: Exit; wrote: string[]; findings?: readonly Finding[]; raised?: readonly Raised[]; why?: string; failed?: string };
function codeBuiltIn(ctx: Context, step: LoopStep, subject: SlotSubject | undefined): BuiltIn | undefined {
  const { root, state } = ctx;
  const settle = settleStep(ctx, step, subject);
  if (settle) return settle;
  if (step.cli === "clossys check --route") {
    // GF2 fix round 1: a route that cannot raise an entry fails the step (exit 1) with its reason, so the step's
    // failure route runs, instead of the run throwing.
    let raised: Raised[];
    try { raised = routeFindings(root, state.findings, iso(ctx.now()), state.loop, `found by ${state.loop} run ${state.runId}`); }
    catch (error) { return { exit: 1, wrote: [], failed: `clossys check --route: ${error instanceof Error ? error.message : String(error)}` }; }
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
 * foundry-build-0048 DET-STEPS: the settle rules. Each one is a fixed rule over the files; when it holds, code answers
 * and every later agent step of the rule's verb is settled (skipped, no packet); when it does not, they run as before.
 *
 * - `reuse <request>` (loop.slot, before the decide steps): the need names a leaf id the assignee has placed; code
 *   decides `reuse <assignee>/<need>` as the producer seat (records/request.ts exactReuseOf). A near match (a part, a
 *   whole, a similar name) reaches the agent.
 * - `impact <ref>` (loop.cascade, before impact): the reverdict passed and the cascade is clean now; code accepts it and
 *   the owner reads only failures.
 * - `brief <ref>` (loop.create, loop.fill, loop.refine, before refine-brief): the trigger names one record and no rule
 *   (T1, T2, T4, T6, T7, T8); only a slot-wide trigger (T3 tighten-brief, T5 owner-feedback) reaches the agent.
 * - `adopt <ref>` (loop.create, loop.fill, loop.refine, before create; round 2, planner D5 Adopt = A): the slot adopts
 *   byte-exact (a Designer components slot under an adopt-first standard, not a consumer asset, one option), holds no
 *   candidate, and a stock item ships its contract fixture with every import locked (records/code-adopt.ts); code
 *   submits that item unmodified at rung L1 (`--by code:adopt`), and the submit guard and the run's certify or check
 *   step judge it like any candidate. With no stock item the agent creates; a refused submit defers to it, and a failed
 *   certify sends the run back to the agent's create step (the retry clears the settle).
 * - `pick <ref>` (loop.choose, loop.fill, loop.refine, before pick; round 2, planner D5 Pick = A): the pin gate's
 *   scorecard has a single top row on a slot with no owner-pick or confirm step and no owner or planner pin
 *   (loop/code-pin.ts); code pins it through the pin gate (`clossys pin --by code:scorecard`, basis scorecard). A tie,
 *   an owner step, a held human decision or a writer pin map reaches the agent pick; a refused pin defers to it.
 */
export const SETTLE_RULES = { reuse: "decide", impact: "check", brief: "refine-brief", adopt: "create-candidates", pick: "pick" } as const satisfies Record<string, DeciderVerb>;
export type SettleRule = keyof typeof SETTLE_RULES;
const SETTLE_CLI = /^clossys settle (reuse|impact|brief|adopt|pick)(?:\s|$)/;
/** The triggers that may carry a rule for the whole slot (the brief): the owner's words, or a tighten-brief run. */
export const SLOT_WIDE_TRIGGERS: readonly string[] = ["T3", "T5"];
export const settlePath = (root: string, runId: string, step: string): string => join(runsDir(root), `${runId}.settle`, `${step}.json`);

/** One settle record: what the rule judged, from which files (by sha256), and the agent steps it settled. */
export interface SettleRecord {
  readonly schema: "clossys.settle/1";
  readonly loop: LoopName;
  readonly runId: string;
  readonly step: string;
  readonly rule: SettleRule;
  readonly round: number;
  readonly at: Iso;
  /**
   * settled: code answered and the agent steps in `settles` are skipped; agent: the rule does not hold, so they run;
   * deferred: the rule could not decide (a refusal or an error, named in `why`), so they run as if no settle step were there.
   */
  readonly outcome: "settled" | "agent" | "deferred";
  readonly settles: readonly string[];
  readonly why: string;
  readonly answer?: string;
  readonly cites: readonly { readonly path: string; readonly sha256: string | null }[];
}
type SettleVerdict = { readonly settled: boolean; readonly why: string; readonly answer?: string; readonly cites: readonly string[]; readonly wrote?: readonly string[] } | { readonly refused: string };

function settleReuse(ctx: Context): SettleVerdict {
  const request = requestOf(ctx);
  if (!request) return { refused: `the run has no request` };
  const file = `clossys/agents/producer/queue.slot/entries/${request.id}.json`;
  const exact = exactReuseOf(join(ctx.root, "clossys"), request);
  if (exact === undefined) return { settled: false, why: `${request.target} names no placed slot of its assignee exactly${request.overlaps?.length ? ` (near matches: ${request.overlaps.map(item => item.slot).join(", ")})` : ""}; the assignee decides`, cites: [file] };
  try { decideRequest(join(ctx.root, "clossys"), request.id, { decision: "reuse", slot: exact, by: "producer", at: iso(ctx.now()) }); }
  catch (error) { if (error instanceof RequestError) return { refused: error.message }; throw error; }
  return { settled: true, why: `${request.target} is the placed slot ${exact}: an exact match is a reuse`, answer: `reuse ${exact}`, cites: [file, `clossys/agents/${exact}/slot.json`], wrote: [file] };
}
function settleImpact(ctx: Context, subject: SlotSubject | undefined): SettleVerdict {
  if (!subject) return { refused: `the run has no slot` };
  const pin = `clossys/agents/${refOf(subject)}/pin.json`;
  if (ctx.state.checks[CASCADE_CLEAN] !== "pass") return { settled: false, why: `the reverdict did not pass ${CASCADE_CLEAN} in this run; the owner reads the failures`, cites: [pin] };
  const clean = verifyCheck(ctx, CASCADE_CLEAN);
  if (!clean.ok) return { settled: false, why: `${clean.why}; the owner reads the failures`, cites: [pin] };
  return { settled: true, why: `every dependant of ${refOf(subject)} passed its re-verdict and ${CASCADE_CLEAN} holds now: code accepts the cascade`, answer: "accept", cites: [pin] };
}
function settleBrief(ctx: Context, subject: SlotSubject | undefined): SettleVerdict {
  if (!subject) return { refused: `the run has no slot` };
  const { code, kind } = ctx.state.trigger;
  const cites = [`clossys/agents/${refOf(subject)}/slot.json`];
  if (SLOT_WIDE_TRIGGERS.includes(code)) return { settled: false, why: `trigger ${code} (${kind}) may carry a rule for the whole slot; the owner of the slot reads it`, cites };
  return { settled: true, why: `trigger ${code} (${kind}) names one record and no rule: the brief stays as it is`, answer: "no tightening", cites };
}

function settlePick(ctx: Context, subject: SlotSubject | undefined): SettleVerdict {
  if (!subject) return { refused: `the run has no slot` };
  const { root } = ctx;
  const { agent, slotId } = subject;
  const slotFile = `clossys/agents/${refOf(subject)}/slot.json`;
  const pinFile = `clossys/agents/${refOf(subject)}/pin.json`;
  const scorecardFile = stateRel("checks", refOf(subject), "scorecard.json");
  const notCode = codeSlotRefusals(root, agent, slotId);
  if (notCode.length) return { settled: false, why: `${notCode.join("; ")}; the pick is not code's`, cites: [slotFile, pinFile] };
  // The ranking the pin gate gives now (no pick yet): the same scorecard `clossys pin` judges and writes.
  const at = iso(ctx.now());
  const ranked = pinGate(root, join(root, "clossys"), agent, slotId, "", at).scorecard;
  const top = ranked.candidates.find(row => row.submitted && row.certified);
  const tie = top === undefined ? "the scorecard has no submitted, certified row" : scorecardTopRefusal(ranked, top.candidate);
  if (top === undefined || tie !== undefined) return { settled: false, why: `${tie}; the agent picks`, cites: [slotFile, `clossys/agents/${refOf(subject)}/ledger.json`] };
  // Code pins through the one pin path: the gate judges the pick again under the slot lock, then the code-pin rules.
  const pinned = pinTargetSlot(root, agent, slotId, top.candidate, { by: CODE_SCORECARD, at, ...(ctx.hooks.guard !== undefined ? { guard: ctx.hooks.guard } : {}) });
  if (pinned.exitCode !== 0) return { refused: pinned.message };
  return {
    settled: true, why: `${top.candidate} is the scorecard's single top row (submitted, certified, ahead of every other row) and ${refOf(subject)} has no owner-pick or confirm step: code pins it`,
    answer: `pin ${top.candidate}`, cites: [slotFile, pinFile, scorecardFile], wrote: [pinFile, `clossys/agents/${refOf(subject)}/ledger.json`, scorecardFile],
  };
}

function settleAdopt(ctx: Context, subject: SlotSubject | undefined): SettleVerdict {
  if (!subject) return { refused: `the run has no slot` };
  const { root } = ctx;
  const { agent, slotId } = subject;
  const slotFile = `clossys/agents/${refOf(subject)}/slot.json`;
  const ledgerFile = `clossys/agents/${refOf(subject)}/ledger.json`;
  const notCode = codeAdoptSlotRefusal(root, agent, slotId);
  if (notCode !== undefined) return { settled: false, why: `${notCode}; the agent creates`, cites: [slotFile] };
  const held = readSlotEntry(join(root, "clossys"), agent, slotId)?.candidates ?? [];
  if (held.length) return { settled: false, why: `${refOf(subject)} holds ${held.join(", ")}; code adopts only into a slot with no candidate, so the agent creates`, cites: [slotFile, ledgerFile] };
  const found = stockItemOf(root, slotId);
  if ("none" in found) return { settled: false, why: `${found.none}; the agent creates`, cites: [slotFile, REFERENCE_MANIFEST] };
  const { stock } = found;
  // The one candidate writer: the code:adopt rule (records/code-adopt.ts), then the submit guard, as for any candidate.
  const written = writeCandidate(join(root, "clossys"), "designer", slotId, stock.item.name, stock.item, {
    canonical: true, at: iso(ctx.now()),
    provenance: { verb: "submit", by: CODE_ADOPT, skill: CODE_ADOPT_SKILL },
    fields: { basis: "code", rung: CODE_ADOPT_RUNG, seed: stock.seed, ladder: { rung: CODE_ADOPT_RUNG, seed: stock.seed } },
    guard: ctx.hooks.guard ?? true,
    header: { createdBy: cliActor(CODE_ADOPT_CLI) },
  });
  return {
    settled: true, why: `${stock.ref} ships ${refOf(subject)}'s contract fixture and the slot adopts byte-exact: code submits it unmodified at rung ${CODE_ADOPT_RUNG}, and certify judges it`,
    answer: `adopt ${stock.ref}`, cites: [slotFile, REFERENCE_MANIFEST], wrote: [`clossys/agents/${refOf(subject)}/candidates/${written.name}`, ledgerFile],
  };
}

const SETTLE_JUDGES: Record<SettleRule, (ctx: Context, subject: SlotSubject | undefined) => SettleVerdict> = {
  reuse: ctx => settleReuse(ctx),
  impact: settleImpact,
  brief: settleBrief,
  adopt: settleAdopt,
  pick: settlePick,
};

/** A `clossys settle <rule>` code step: judges its rule, records the settle and logs a run.settle engine event. */
function settleStep(ctx: Context, step: LoopStep, subject: SlotSubject | undefined): BuiltIn | undefined {
  const match = SETTLE_CLI.exec(step.cli);
  if (!match) return undefined;
  const { root, state } = ctx;
  const rule = match[1] as SettleRule;
  // The failure route: a rule that refuses or throws decides nothing; the agent step it precedes runs, and the
  // deferral is recorded like any settle. Only a settle record that cannot be written fails the step (its onFail).
  let verdict: SettleVerdict;
  try { verdict = SETTLE_JUDGES[rule](ctx, subject); }
  catch (error) { verdict = { refused: error instanceof Error ? error.message : String(error) }; }
  const judged = "refused" in verdict ? undefined : verdict;
  const deferred = "refused" in verdict ? verdict.refused : undefined;
  const settledBy = judged?.settled === true;
  const later = ctx.version.steps.slice(ctx.version.steps.indexOf(step) + 1);
  const settles = settledBy ? later.filter(each => each.decider.by === "agent" && each.decider.verb === SETTLE_RULES[rule]).map(each => each.id) : [];
  const settled = state.settled ?? {};
  for (const [id, by] of Object.entries(settled)) if (by === step.id) delete settled[id];
  for (const id of settles) settled[id] = step.id;
  state.settled = settled;
  try {
    const cites = inputsOf(root, (judged?.cites ?? []).map(path => join(root, path)));
    const record: SettleRecord = {
      schema: "clossys.settle/1", loop: state.loop, runId: state.runId, step: step.id, rule, round: state.round, at: iso(ctx.now()),
      outcome: judged === undefined ? "deferred" : settledBy ? "settled" : "agent", settles,
      why: judged === undefined ? `code could not decide (${deferred}); the agent step decides` : judged.why,
      ...(judged?.answer !== undefined ? { answer: judged.answer } : {}), cites,
    };
    const file = settlePath(root, state.runId, step.id);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    const wrote = [...(judged?.wrote ?? []), relative(root, file).split(sep).join("/")];
    logRun(root, "run.settle", state, wrote.map(path => join(root, path)));
    return { exit: 0, wrote };
  } catch (error) {
    // Nothing settled without its record: the agent steps stay unsettled and the step's onFail route runs.
    for (const id of settles) delete settled[id];
    return { exit: 1, wrote: [], why: `the settle record could not be written: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * A built-in code step runs observed, like any traced step (pipeline/trace.ts): it appends one
 * clossys.pipeline-run/1 record to `clossys/.state/runs/<loop>.<step>.jsonl` with every file it read and
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
    watch.observation.writes.add(isStateRel(rel) ? join(ctx.root, rel) : join(agentsDir(ctx.root), rel));
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
 * agents-relative form (`clossys/agents/` dropped, `clossys/.state/...` kept), or why it is refused. Only the root's own real
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
 * The queue entries an agent step names by their exact path in its `writes` (with `<request>`, `<slot>` and `<slot-id>`
 * filled for the run), as snapshot keys: loop.slot's decide step names its own `producer/queue.slot/entries/<request>.json`.
 * A wildcard write names no entry.
 */
export function stepEntryKeys(state: Pick<RunState, "subject" | "request">, step: Pick<LoopStep, "writes">): string[] {
  const slot = state.subject ? `${state.subject.agent}/${state.subject.slotId}` : undefined;
  const out: string[] = [];
  for (const write of step.writes ?? []) {
    let path = write.replace(/^clossys\/agents\//, "");
    if (slot) path = path.replace(/^<slot>(?=\/|$)/, slot).replaceAll("<slot-id>", state.subject!.slotId);
    if (state.request) path = path.replaceAll("<request>", state.request);
    if (/^producer\/queue\.[a-z]+\/entries\/[^/*<>]+\.json$/.test(path)) out.push(`clossys/agents/${path}`);
  }
  return out;
}

/**
 * U9a: the files an agent step of an agent's own loop version reported writing that it may not write: outside the root,
 * through `..`, through a symlink or a hard link (`agentWriteRef`), a Producer-owned file (anything but what the
 * standard's own step of that id declares, filled for the run, or the agent write allowlist `agentWriteClass`; a slot
 * request under the allowlist must be a new one the step's own agent raised), or matching none of the step's `writes` (with
 * `<slot>` the run's own slot). Producer's standard version is judged the same way (foundry-build-0048 U26 r1 B1: its
 * agent steps write only what they declare); empty only for a Producer version of a loop that is not an agent loop.
 * Each step is judged as the agent its decider resolves to (stepAgentOf), the agent advance runs it as, never the run's
 * `--agent` (U26 r2: loop.scope runs one step per agent, and one agent's step may not raise under another's name).
 * The runner judges the files the step reports (the resumer's `--wrote` list or the code hook's outcome) and refuses
 * symlinked and hard-linked ones; a write the step does not report is caught by the snapshot diff (agent-snapshot.ts) before this runs.
 *
 * U9a fix round 4 (blind1 B1): a slot request and a candidate are create-only: one that was in `before` (the snapshot
 * taken before the step) is refused, unless the standard's own step names that exact file (loop.slot's decide step
 * answers its own `<request>` entry). Without a snapshot every write is refused (fail closed).
 */
export function undeclaredWrites(root: string, state: RunState, step: LoopStep, wrote: readonly string[] | undefined, before: TreeFiles | undefined): string[] {
  if ((state.version.ref.startsWith("producer/") && !isAgentLoop(state.loop)) || step.decider.by !== "agent" || !wrote?.length) return [];
  // The agent the step runs as (its decider), never the run's --agent: each step's writes are judged as its own agent's.
  const agent = stepAgentOf(root, state, step);
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

const QUEUE_WRITE = /^producer\/(queue\.[a-z]+)\/entries\/\*?$/;
/** The entries now in the Producer queue folders a step declares it writes, as `queue.<kind>#<id>`. */
function declaredQueueEntries(root: string, step: LoopStep): Set<string> {
  const out = new Set<string>();
  for (const pattern of step.writes ?? []) {
    const match = QUEUE_WRITE.exec(pattern);
    if (!match) continue;
    const dir = join(agentsDir(root), "producer", match[1]!, "entries");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) if (name.endsWith(".json")) out.add(`${match[1]!}#${name.slice(0, -".json".length)}`);
  }
  return out;
}

/** onFail and exit 2 (null: go on). */
async function afterStep(ctx: Context, step: LoopStep, exit: Exit, findings: readonly Finding[], subject: SlotSubject | undefined, raisedByStep = false, why?: string): Promise<RunResult | null> {
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
  // GF2 fix round 1: the failing step's reason stays in the stop message, after the route taken.
  const because = why ? `; why: ${why}` : "";
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
    return stop(ctx, `${step.id} failed; ${names.length ? `raised ${names.join(", ")}; ` : ""}${step.onFail.then} runs from ${names[0] ?? "the open entry"}${because}`, 1);
  }
  if (step.onFail.raise === "queue.clarify") return waitOnClarify(ctx, step, subject);
  state.round++;
  if (state.round > version.maxRounds) {
    const entry = raiseFor(ctx, subject, `${version.maxRounds} rounds of ${state.loop} did not pass ${step.id}${subject ? ` for ${refOf(subject)}` : ""}`, at, false);
    if (entry) state.raised.push(entryName(entry));
    return stop(ctx, `${step.id} failed ${version.maxRounds} rounds (maxRounds); raised ${entry ? entryName(entry) : "nothing"}${because}`, 1);
  }
  const fix = raiseStepFix(ctx, step, subject, `${label} failed${subject ? ` for ${refOf(subject)}` : ""}; round ${state.round} of ${version.maxRounds}`, at, state.round - 1);
  if (fix && !state.raised.includes(entryName(fix))) state.raised.push(entryName(fix));
  let back = state.cursor;
  for (let index = state.cursor - 1; index >= 0; index--) {
    const earlier = version.steps[index]!;
    if (earlier.decider.by === "agent" && earlier.decider.verb === "create-candidates") { back = index; break; }
  }
  // A create step code settled (a code adopt) failed its check: the retry is the agent's create, never code's again.
  const retried = version.steps[back]!;
  if (back !== state.cursor && state.settled?.[retried.id] !== undefined) delete state.settled[retried.id];
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
  // A request run (loop.slot) has no slot yet: its clarify is about the request entry itself.
  if (!to && ctx.state.request) return { queue: "queue.clarify", subject: { to: "producer/queue.slot" as Ref["to"], record: ctx.state.request, rel: "input" }, decider: "owner", ask, slug: ctx.state.request };
  // GF2 fix round 1: a run with no subject (loop.scope, loop.audit) asks about the loop run itself: its loop's ledger
  // folder (made here, so the ref never dangles while the run waits), with the run id in the ask.
  if (!to && LOOP_SUBJECT[ctx.state.loop] === "none") {
    mkdirSync(ledgerDir(ctx.root, ctx.state.loop), { recursive: true });
    const ledger = `producer/${ledgerOf(ctx.state.loop)}`;
    return { queue: "queue.clarify", subject: { to: ledger as Ref["to"], rel: "input" }, decider: "owner", ask: `${ask} (run ${ctx.state.runId})`, slug: ledgerOf(ctx.state.loop) };
  }
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
  // GF2 fix round 1: a subject-less run (loop.scope, loop.audit) has no slot to take the fix, so it asks the owner.
  if (!target) return LOOP_SUBJECT[ctx.state.loop] === "none" ? raiseFor(ctx, subject, ask, at) : undefined;
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

/**
 * LOOP-STEPS: a create step that raised an upstream request and did not make its candidates (exit 1 or 2) waits on
 * the request it raised (`then: retry`): the step runs again when the request closes (readRetry).
 */
function waitOnRaised(ctx: Context, step: LoopStep, entry: string): Promise<RunResult> {
  const { root, state } = ctx;
  state.status = "waiting"; state.waiting = { step: step.id, on: "entry", entry, then: "retry" };
  saveState(root, state);
  return Promise.resolve({ exitCode: 0, state, entry, message: `run ${state.runId}: step ${step.id} raised ${entry} and waits until it closes; then the step runs again` });
}

/** A raised clossys.queue-entry/2 request named `queue.<slot|change|fix>#<id>`, when one reads as valid. */
const RAISED_ENTRY = /^queue\.(slot|change|fix)#(.+)$/;
function readRaised(root: string, name: string): SlotRequest | undefined {
  const match = RAISED_ENTRY.exec(name);
  if (!match || !REQUEST_ID.test(match[2]!)) return undefined;
  try {
    const request = readRequest(join(root, "clossys"), match[2]!);
    return workQueue(request.kind) === `queue.${match[1]}` ? request : undefined;
  } catch (error) {
    if (error instanceof RequestError) return undefined;
    throw error;
  }
}

/** The run's raised upstream requests still open other than `but`: entries from the run's own slot about another slot. */
function openRaises(root: string, state: RunState, but: string): string[] {
  const from = state.subject ? `${state.subject.agent}/${state.subject.slotId}` : undefined;
  return state.raised.filter(name => name !== but).filter(name => {
    const request = from === undefined ? undefined : readRaised(root, name);
    return request !== undefined && request.status === "open" && request.from === from && request.target !== from;
  });
}

const RAISE_KEY = /^clossys\/agents\/producer\/queue\.(slot|change)\/entries\/([^/]+)\.json$/;
/**
 * LOOP-STEPS: the upstream requests a create step raised (`<agent>.candidates`: "raise a request (clossys request
 * --kind change --subject <agent>/<slot> --from <agent>/<slot> ..., or a slot need)"): every reported file that is a
 * new kind change or slot entry (absent from `before`). Each must be a regular file with one link named by its id and
 * exactly the entry the request verb raises for the step's agent from the run's own slot (agentWorkRaiseIssues for a
 * change, freshRaiseIssues for a slot need); one that is not is an issue, and the step is refused. An entry that was
 * there before is no raise: it is left to the write allowlist, which refuses it.
 */
export function stepRaises(root: string, state: Pick<RunState, "subject">, agent: AgentId, wrote: readonly string[] | undefined, before: TreeFiles): { keys: string[]; names: string[]; issues: string[] } {
  const keys: string[] = [], names: string[] = [], issues: string[] = [];
  for (const file of wrote ?? []) {
    const key = snapshotKey(root, wroteFile(root, file));
    const match = RAISE_KEY.exec(key);
    if (!match || key in before) continue;
    const shown = key.slice("clossys/agents/".length);
    const from = state.subject ? `${state.subject.agent}/${state.subject.slotId}` : undefined;
    if (from === undefined || state.subject!.agent !== agent || !isContentAgent(agent)) { issues.push(`${shown}: only a slot's own agent raises from its slot`); continue; }
    if ("refused" in agentWriteRef(root, file)) { issues.push(`${shown}: is not a regular file with one link`); continue; }
    let doc: unknown;
    try { doc = JSON.parse(readFileSync(join(root, ...key.split("/")), "utf8")); } catch { issues.push(`${shown}: is not JSON`); continue; }
    const id = typeof doc === "object" && doc !== null ? (doc as { id?: unknown }).id : undefined;
    if (`${String(id)}.json` !== `${match[2]!}.json`) { issues.push(`${shown}: is not named by its id ${String(id)}`); continue; }
    const consumer = join(root, "clossys");
    const why = match[1] === "change" ? agentWorkRaiseIssues(consumer, doc, agent, from)
      : (doc as { from?: unknown }).from !== from ? [`from ${String((doc as { from?: unknown }).from)}: the step raises only from the run's own slot ${from}`] : freshRaiseIssues(consumer, doc, agent);
    if (why.length) { issues.push(`${shown}: ${why.join("; ")}`); continue; }
    keys.push(key); names.push(`queue.${match[1]!}#${String(id)}`);
  }
  return { keys, names, issues };
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

/** The slot's write lock (records/slot-write.ts SLOT_LOCK): the lock `clossys pin` takes around a decision write. */
const lockSlot = <T>(root: string, subject: SlotSubject, action: () => T): T =>
  withDirLock(join(root, "clossys", "agents", subject.agent, subject.slotId, SLOT_LOCK), "Slot is unavailable or another decision write is in progress", action);
const failure = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * B5: the owner's approve on a confirm step: the agent's pin gains `confirmed` (by the owner, from this entry). The
 * write is the ledgered confirmation `clossys pin --confirm` makes (writeTargetConfirm under the slot lock): pin.json
 * and its `confirm` event land together and the pin guard runs, so the slot's pin stays bound to its ledger.
 */
function confirmPin(ctx: Context, subject: SlotSubject, entry: QueueEntry): { exit: Exit; wrote: string[]; why?: string } {
  const { root } = ctx;
  const { agent, slotId } = subject;
  const file = pinPath(root, agent, slotId);
  try {
    return lockSlot(root, subject, () => {
      const read = readPinFile(file, { agent, slotId });
      if (read.kind !== "pin" || read.issues.length) return { exit: 1 as Exit, wrote: [], why: `${refOf(subject)} has no valid pin for the owner to confirm${read.kind === "pin" || read.kind === "invalid" || read.kind === "pin/1" ? `: ${read.issues.join("; ")}` : ""}` };
      const pin = read.doc;
      if (!confirmableBasis(pin.basis)) return { exit: 1 as Exit, wrote: [], why: `${refOf(subject)} is pinned by ${pin.decidedBy} (basis ${pin.basis}); only an agent or code pick is confirmed` };
      const at = iso(ctx.now());
      const answers: Ref = { to: `producer/${entry.queue}` as Ref["to"], record: entry.id, rel: "answers" };
      const confirmed = { by: "owner" as const, ref: entryName(entry), at };
      const doc = {
        ...buildPin({
          agent, slotId, createdBy: pin.createdBy, previous: pin, refs: mergeRefs(pin.refs, [answers]),
          record: { candidate: pin.candidate, sha256: pin.sha256, decidedBy: pin.decidedBy, basis: pin.basis, at: pin.at, confirmed },
        }),
        updatedAt: at,
      };
      const issues = pinIssues(doc, { agent, slotId });
      if (issues.length) return { exit: 1 as Exit, wrote: [], why: `the confirmed pin of ${refOf(subject)} would not be valid: ${issues.join("; ")}` };
      writeTargetConfirm(join(root, "clossys"), agent as SlotAgent, slotId, { candidate: pin.candidate, sha256: pin.sha256, confirmed, by: `owner:${entryName(entry)}`, at }, () => writePinDoc(file, doc), ctx.hooks.guard ?? true);
      return { exit: 0 as Exit, wrote: [`${refOf(subject)}/pin.json`, `${refOf(subject)}/ledger.json`] };
    });
  } catch (error) {
    return { exit: 1, wrote: [], why: `the owner's confirm of ${refOf(subject)} was refused: ${failure(error)}` };
  }
}

/**
 * B5: the owner rejected the agent's pick: the slot's pin goes back to what it was when the run started. A pin put
 * back is ledgered as the decision it restores (writeTargetDecision under the slot lock, the `pick` or `pin` event
 * `clossys pin` writes, with the restored record's candidate, sha256, decidedBy and basis), so the restored bytes are
 * the ones the slot's last ledger event records; the pin guard runs on it and a refusal leaves the slot as it was.
 */
function revertPin(ctx: Context, subject: SlotSubject): { exit: Exit; wrote: string[]; why?: string } {
  const { root, state } = ctx;
  const { agent, slotId } = subject;
  const file = pinPath(root, agent, slotId);
  const before = state.startPinDoc ?? null;
  const restore = (bytes: string) => {
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, bytes);
    renameSync(temp, file);
  };
  let reverted: { exit: Exit; wrote: string[] };
  try {
    reverted = lockSlot(root, subject, () => {
      const now = existsSync(file) ? readFileSync(file, "utf8") : null;
      if (now === before) return { exit: 1 as Exit, wrote: [] };
      if (before === null) { unlinkSync(file); return { exit: 1 as Exit, wrote: [`${refOf(subject)}/pin.json`] }; }
      const key = restoredRecord(before, now === null ? undefined : readPinFile(file, { agent, slotId }));
      writeTargetDecision(join(root, "clossys"), agent as SlotAgent, slotId, key !== undefined ? { record: key } : {}, () => {
        restore(before);
        const read = readPinFile(file, { agent, slotId });
        const record = read.kind === "pin" ? read.doc : read.kind === "pin-map" && key !== undefined ? read.doc.records[key] : undefined;
        if (!record) throw new Error(`the pin ${refOf(subject)} had when the run started is not a clossys.pin/2 or clossys.pin-map/1 record`);
        return { candidate: record.candidate, sha256: record.sha256, decidedBy: record.decidedBy, basis: record.basis, at: record.at };
      }, ctx.hooks.guard ?? true);
      return { exit: 1 as Exit, wrote: [`${refOf(subject)}/pin.json`, `${refOf(subject)}/ledger.json`] };
    });
  } catch (error) {
    return { exit: 1, wrote: [], why: `the owner's reject could not put back the pin ${refOf(subject)} had when the run started: ${failure(error)}` };
  }
  // The run's own record of the put-back (engine.md "Writers"), beside the slot ledger's decision event: a removal
  // has no ledger event, and every put-back names the run that made it.
  if (reverted.wrote.length) logRun(root, "pin.revert", state, [file]);
  return reverted;
}

/**
 * The pin-map record a restored pin re-records (undefined for a pin/2): the first record whose bytes differ from the
 * slot's pin now (every record when the pin now is no pin map), else the first record.
 */
function restoredRecord(before: string, current: ReturnType<typeof readPinFile> | undefined): string | undefined {
  let doc: unknown;
  try { doc = JSON.parse(before); } catch { return undefined; }
  const records = (doc as { schema?: unknown; records?: Record<string, unknown> }).schema === "clossys.pin-map/1" ? (doc as { records?: Record<string, unknown> }).records ?? {} : undefined;
  if (!records) return undefined;
  const now = current?.kind === "pin-map" ? current.doc.records as Record<string, unknown> : {};
  const keys = Object.keys(records);
  return keys.find(key => JSON.stringify(records[key]) !== JSON.stringify(now[key])) ?? keys[0];
}

/** The clarify a retry waits on: answered, the step runs again (from advance's loop). */
async function readRetry(ctx: Context): Promise<RunResult | null> {
  const { root, state } = ctx;
  const waiting = state.waiting;
  if (!waiting || waiting.on !== "entry" || waiting.then !== "retry") return null;
  if (RAISED_ENTRY.test(waiting.entry)) {
    // LOOP-STEPS: an upstream request the step raised; closed (whatever its outcome), the step runs again and reads it.
    const raised = readRaised(root, waiting.entry);
    if (!raised) return stop(ctx, `${waiting.entry} is gone`, 2);
    if (raised.status === "open") return { exitCode: 0, state, entry: waiting.entry, message: `run ${state.runId}: ${waiting.step} still waits on ${waiting.entry} (assigned to ${raised.assignee})` };
    state.refs.push({ to: `producer/${workQueue(raised.kind)}` as Ref["to"], record: raised.id, rel: "cites" });
    const next = openRaises(root, state, waiting.entry)[0];
    if (next) {
      state.waiting = { step: waiting.step, on: "entry", entry: next, then: "retry" };
      saveState(root, state);
      return { exitCode: 0, state, entry: next, message: `run ${state.runId}: ${waiting.step} still waits on ${next} (${waiting.entry} closed)` };
    }
    delete state.waiting;
    return null;
  }
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
  logRun(root, "run.record", state, [file]);
  state.status = status; state.outcome = outcome; state.ledger = ledgerPath(root, file);
  delete state.waiting;
  saveState(root, state);
  return { exitCode, state, message: `run ${state.runId}: ${status}: ${outcome}` };
}

/**
 * flows.md F1 (T1): `clossys ia sync`, then the fill queue, then `clossys check`, then one ledger entry
 * `<stamp>-fill-init` with `outcome: "initialized"`. Not a loop version of its own: it is the one-time prelude of `loop.fill`.
 *
 * FILL-PRELUDE D1 (foundry-build-0048): an unpinned package leaf is a queue entry of loop.fill (flows.md F2), not an
 * init finding. The queue step writes one `run.queue` event per leaf and holds the queue those events name against
 * every unpinned leaf (fill.queued); pins.resolve judges only the slots that hold a pin or a candidate; and the check
 * step's verb exit is judged from its findings, where a slot-integrity no-pin or no-candidate on a queued leaf is that
 * leaf's queue entry. `clossys check --suites --strict` and `--slots --readiness` judge every slot, as before.
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
    { id: "queue", cli: "clossys run loop.fill", checks: [FILL_QUEUED] },
    { id: "check", cli: "clossys check", checks: ["pins.resolve"] },
  ];
  for (const step of prelude) {
    const outcome = step.id === "queue" ? queueFill(ctx) : await hooks.code({ runId: state.runId, step: step.id, cli: step.cli, argv: stepArgv(step.cli, {}).argv.slice(1) });
    // Each check is judged from the files after the step, never copied from the step's exit (CONSISTENCY round 2):
    // a failed ia sync whose orphans pass records ia.orphans as passed, and an exit 0 over a failing check stops (B3).
    const judged = step.checks.map(check => ({ check, verdict: preludeCheck(ctx, check) }));
    for (const { check, verdict } of judged) state.checks[check] = verdict.ok ? "pass" : "fail";
    const failed = judged.filter(each => !each.verdict.ok).map(each => (each.verdict as { why: string }).why);
    const verb = step.id === "check" ? checkStepExit(ctx, outcome) : { exit: outcome.exit };
    if (verb.why) failed.push(verb.why);
    const exit: Exit = verb.exit === 0 && failed.length ? 1 : verb.exit;
    state.steps.push({ id: step.id, decider: { by: "code" }, cli: step.cli, exit, wrote: wroteOf(root, outcome.wrote) });
    if (exit !== 0) return writeLedger(ctx, "stopped", `init stopped at ${step.id} (exit ${exit})${failed.length ? `: ${failed.join("; ")}` : ""}`, exit);
  }
  return writeLedger(ctx, "done", "initialized", 0);
}

/** The init check that every unpinned leaf is a queue entry of loop.fill (FILL-PRELUDE D1). */
export const FILL_QUEUED = "fill.queued";
/** The engine event of one fill queue entry: subject the init run, input the leaf's slot.json. */
export const RUN_QUEUE = "run.queue";

/** The init's queue step (flows.md F2 step 1, by code): one run.queue event per slot loop.fill would fill, in chain order. */
function queueFill(ctx: Context): CodeOutcome {
  const { root, state } = ctx;
  for (const subject of fillQueue(root)) logRun(root, RUN_QUEUE, state, [join(root, "clossys", "agents", subject.agent, subject.slotId, "slot.json")]);
  state.queue = queuedRefs(root, state);
  state.vars.queue = String(state.queue.length);
  return { exit: 0 };
}

/** The `<agent>/<slot-id>` refs this run's run.queue events name, in log order: the queue as recorded, not as computed. */
export function queuedRefs(root: string, state: Pick<RunState, "loop" | "runId">): string[] {
  const subject = `loop:${state.loop}/${state.runId}`;
  const out: string[] = [];
  for (const line of readEventLines(root).lines) {
    let event: { kind?: unknown; subject?: unknown; inputs?: { path?: unknown }[] };
    try { event = JSON.parse(line) as typeof event; } catch { continue; }
    if (event.kind !== RUN_QUEUE || event.subject !== subject) continue;
    const match = /^clossys\/agents\/([a-z]+)\/([^/]+)\/slot\.json$/.exec(String(event.inputs?.[0]?.path ?? ""));
    if (match && !out.includes(`${match[1]}/${match[2]}`)) out.push(`${match[1]}/${match[2]}`);
  }
  return out;
}

/** fill.queued: every unpinned leaf (slots.ts unpinnedLeaves, its own listing) is named by a run.queue event of this run. */
export function judgeFillQueued(root: string, state: Pick<RunState, "loop" | "runId">): { ok: true } | { ok: false; why: string } {
  const queued = new Set(queuedRefs(root, state));
  const unqueued = unpinnedLeaves(root).filter(ref => !queued.has(ref));
  return unqueued.length ? { ok: false, why: `${FILL_QUEUED}: ${unqueued.length} unpinned leaves are not queued: ${unqueued.slice(0, 5).join(", ")}${unqueued.length > 5 ? ` (+${unqueued.length - 5} more)` : ""}` } : { ok: true };
}

/** Slot-integrity rules of `clossys check` that an unpinned leaf raises by being unpinned: its queue entry, not an init finding. */
const QUEUED_LEAF_RULES: readonly string[] = ["no-pin", "no-candidate"];

/**
 * The check step's exit, judged from the verb's findings (FILL-PRELUDE D1): an exit 1 whose every finding is a
 * slot-integrity no-pin or no-candidate on a queued leaf passes; any other finding, a finding with no slot, an exit 1
 * with no findings, or an exit 2 stays as the verb said. The verb's own exit is kept in the run's vars.
 */
function checkStepExit(ctx: Context, outcome: CodeOutcome): { exit: Exit; why?: string } {
  if (outcome.exit !== 1 || !outcome.findings?.length) return { exit: outcome.exit };
  const queued = new Set(ctx.state.queue ?? []);
  const isQueuedLeaf = (finding: Finding): boolean => finding.check === SLOT_INTEGRITY && QUEUED_LEAF_RULES.includes(finding.detail.split(":")[0]!) && queued.has(finding.subject);
  const other = outcome.findings.filter(finding => !isQueuedLeaf(finding));
  ctx.state.vars["check-exit"] = "1";
  ctx.state.vars["check-queued-findings"] = String(outcome.findings.length - other.length);
  if (!other.length) return { exit: 0 };
  return { exit: 1, why: `clossys check: ${other.slice(0, 5).map(finding => `${finding.check} ${finding.subject} ${finding.detail}`).join("; ")}${other.length > 5 ? ` (+${other.length - 5} more)` : ""}` };
}

/** The check name loop/cli.ts gives a `clossys check` slot-integrity finding (check/slot-resolve.ts). */
export const SLOT_INTEGRITY = "slot.integrity";

/** One prelude check of runInit, computed from the consumer's files: the tree checks by their own run, pins.resolve as B3 verifies it over the slots that hold a pin or a candidate, fill.queued from the run.queue events. */
function preludeCheck(ctx: Context, name: string): { ok: true } | { ok: false; why: string } {
  if (name === "pins.resolve") {
    const findings = checkPinsResolve(ctx.root, "held").findings;
    return findings.length ? { ok: false, why: `pins.resolve: ${findings.map(finding => `${finding.subject} ${finding.detail}`).join("; ")}` } : { ok: true };
  }
  if (name === FILL_QUEUED) return judgeFillQueued(ctx.root, ctx.state);
  const tree = name === IA_ORPHANS ? runIaOrphans(ctx.root) : name === RECORDS_COMPUTED_MATCH ? runRecordsComputedMatch(ctx.root) : undefined;
  if (!tree) return verifyCheck(ctx, name);
  return tree.status === "fail" ? { ok: false, why: `${name}: ${tree.findings.slice(0, 3).map(row => `${row.subject} ${row.detail}`).join("; ")}${tree.findings.length > 3 ? ` (+${tree.findings.length - 3} more)` : ""}` } : { ok: true };
}

/**
 * flows.md F2 repeat: `loop.fill` for the next slot still on a package default (chain order), again and again, until
 * none is left or a run waits or stops. A slot filled once in this call is not filled again in it. Given the init's
 * `queue`, it works that queue in its order, passing over an entry that is pinned (or no longer fillable) by now.
 */
export async function fillAll(root: string, hooks: RunHooks, options: RunOptions & { readonly limit?: number; readonly queue?: readonly string[] } = {}): Promise<RunResult[]> {
  const results: RunResult[] = [];
  const done = new Set<string>();
  const next = (): SlotSubject | undefined => {
    if (!options.queue) return nextFillSlot(root, done);
    const fillable = new Map(fillQueue(root).map(subject => [refOf(subject), subject] as const));
    for (const ref of options.queue) if (!done.has(ref) && fillable.has(ref)) return fillable.get(ref);
    return undefined;
  };
  for (let n = 0; n < (options.limit ?? 1000); n++) {
    const subject = next();
    if (!subject) break;
    done.add(refOf(subject));
    const result = await startRun(root, { loop: "loop.fill", slot: refOf(subject) }, hooks, options);
    results.push(result);
    if (result.exitCode !== 0 || result.state?.status !== "done") break;
  }
  return results;
}
