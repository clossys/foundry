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
import { existsSync, mkdirSync, openSync, closeSync, writeSync, readFileSync, renameSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { answerQueueEntry } from "../queue/answer.js";
import { entryStamp, findQueueEntry, readQueueEntry, slugOf } from "../queue/entry.js";
import { sha256Hex } from "../records/hash.js";
import { resolveSlot } from "../records/resolve.js";
import { validateAgainst } from "../records/schema.js";
import { recordSchema, writeSlot } from "../records/slot.js";
import type { AgentId, Decider, DeciderVerb, Iso, LedgerEntry, LoopStep, LoopVersion, QueueEntry, Ref, Tier } from "../records/types.js";
import { RUN_BY, RUN_CLI, entryName, producerVersion, raiseEntry, routeFindings, type Finding } from "./route.js";
import { dependantsOf, fillNames, nextFillSlot, readSubject, refOf, skillFor, slotCandidates, slotVars, whenMatches, type SlotSubject } from "./slots.js";
import { LOOP_SUBJECT, LOOP_TRIGGERS, OWNER_OF_SLOT, RELEASE_READY, TRIGGER_KINDS, ledgerOf, loopStem, type LoopName } from "./names.js";
import { checkReleaseReady } from "../release/ready.js";
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
export interface CodeOutcome { readonly exit: Exit; readonly wrote?: readonly string[]; readonly findings?: readonly Finding[]; readonly detail?: string }

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
  steps: LedgerStep[];
  checks: Record<string, "pass" | "fail">;
  decisions: { entry: string; answer: string }[];
  refs: Ref[];
  raised: string[];
  vars: Record<string, string>;
  findings: Finding[];
  waiting?: Waiting;
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
  let from: QueueEntry | undefined;
  if (input.from !== undefined) {
    from = readEntry(root, input.from);
    if (!from) return { ok: false, reason: `--from ${input.from}: no such queue entry` };
    if (from.status !== "open") return { ok: false, reason: `--from ${entryName(from)} is ${from.status}; a run starts from an open entry` };
  }
  let subject: SlotSubject | undefined;
  if (needs === "slot") {
    const ref = input.slot ?? (from ? from.subject.to.split("/").slice(0, 2).join("/") : undefined);
    if (!ref) return { ok: false, reason: `${input.loop} runs for one slot: --slot <agent>/<slot-id> or --from <entry>` };
    const [agent, slotId] = ref.split("/") as [AgentId, string];
    subject = slotId ? readSubject(root, agent, slotId) : undefined;
    if (!subject) return { ok: false, reason: `${ref} is not a consumer slot (clossys/agents/${ref}/slot.json, slot/2)` };
  }
  if (needs === "publication" && !input.publication) return { ok: false, reason: `${input.loop} runs for one publication: --publication <id>` };
  if (needs !== "slot" && input.slot) return { ok: false, reason: `${input.loop} takes no --slot` };
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
    steps: [], checks: {}, decisions: [], refs: [], raised: [], vars: {}, findings: [],
  };
  return { ok: true, state, loaded: load.loaded };
}

export async function startRun(root: string, input: StartInput, hooks: RunHooks, options: RunOptions = {}): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const plan = planRun(root, input, iso(now()));
  if (!plan.ok) return { exitCode: 2, message: `run: ${plan.reason}` };
  saveState(root, plan.state);
  return advance(root, plan.state, plan.loaded.content, hooks, now);
}

/** Resumes a waiting run. A finished step never runs again; the waiting step runs (or is read from its entry). */
export async function resumeRun(root: string, runId: string, hooks: RunHooks, options: RunOptions = {}): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const state = readRunState(root, runId);
  if (!state) return { exitCode: 2, message: `run: no run ${runId} in .clossys/runs/loops/` };
  if (state.status !== "waiting" && state.status !== "running") return { exitCode: 2, state, message: `run: ${runId} is ${state.status}; only a waiting run resumes` };
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

function recordStep(ctx: Context, step: LoopStep, decider: Decider, cli: string, exit: Exit, wrote: readonly string[] | undefined, vars: Record<string, string>): void {
  ctx.state.steps.push({ id: step.id, decider, cli, exit, wrote: wroteOf(ctx.root, wrote) });
  for (const check of step.checks) {
    const filled = fillNames(check, vars);
    if (filled.unfilled.length) continue;
    // release.ready is the check itself, run on the tree now, never the step's exit code (flows.md F8 step 6).
    ctx.state.checks[filled.text] = filled.text === RELEASE_READY
      ? (ctx.state.publication ? checkReleaseReady(ctx.root, ctx.state.publication).status : "fail")
      : exit === 0 ? "pass" : "fail";
  }
}

async function advance(root: string, state: RunState, version: LoopVersion, hooks: RunHooks, now: () => Date): Promise<RunResult> {
  const ctx: Context = { root, state, version, hooks, now };
  const retry = await readRetry(ctx);
  if (retry) return retry;
  state.status = "running";
  while (state.cursor < version.steps.length) {
    const step = version.steps[state.cursor]!;
    const subject = subjectOf(ctx);
    if (state.subject && !subject) return stop(ctx, `${state.subject.agent}/${state.subject.slotId} is no longer a consumer slot`, 2);
    if (!whenMatches(step.when, subject)) { state.cursor++; continue; }
    const vars = varsOf(ctx, subject);
    const filled = fillNames(step.cli, vars);
    const decider = step.decider;

    if (decider.by === "human") {
      const result = await humanStep(ctx, step, subject, vars, filled.text);
      if (result) return result;
      continue;
    }

    let exit: Exit; let wrote: readonly string[] | undefined; let findings: readonly Finding[] = []; let ledgerDecider: Decider; let cli = filled.text;
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
        const outcome = await hooks.code({ runId: state.runId, step: step.id, cli: filled.text, argv: filled.text.split(/\s+/).filter(Boolean), ...(subject ? { ref: refOf(subject) } : {}), ...(state.publication ? { publication: state.publication } : {}) });
        exit = outcome.exit; wrote = outcome.wrote; findings = outcome.findings ?? [];
      }
    }
    delete state.waiting;
    recordStep(ctx, step, ledgerDecider, cli, exit, wrote, vars);
    state.findings = [...findings];
    const manifest = step.id === "manifest" && wrote?.length ? wrote[0]! : undefined;
    if (manifest) state.vars.manifest = manifest.split("/").pop()!;
    const result = await afterStep(ctx, step, exit, findings, subject);
    if (result) return result;
  }
  return finish(ctx);
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
  if (step.onFail.raise === "queue.clarify") {
    const entry = raiseFor(ctx, "queue.clarify", subject, `${label} failed${subject ? ` for ${refOf(subject)}` : ""}: what should it do?`, at, false);
    if (!entry) return stop(ctx, `step ${step.id} failed and no clarify entry could be raised`, 1);
    state.raised.push(entryName(entry));
    state.status = "waiting"; state.waiting = { step: step.id, on: "entry", entry: entryName(entry), then: "retry" };
    saveState(root, state);
    return { exitCode: 0, state, entry: entryName(entry), message: `run ${state.runId}: ${step.id} failed; waits for the owner on ${entryName(entry)}` };
  }
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

function raiseFor(ctx: Context, queue: "queue.fix" | "queue.clarify", subject: SlotSubject | undefined, ask: string, at: Iso, dedupe = true): QueueEntry | undefined {
  const publicationRef = ctx.state.publication ? `publisher/release.${ctx.state.publication}` : undefined;
  const to = subject ? refOf(subject) : publicationRef;
  if (!to) return undefined;
  const agent = (subject?.agent ?? "publisher") as AgentId;
  const decider: QueueEntry["decider"] = queue === "queue.fix" ? `agent:${agent}` : "owner";
  return raiseEntry(ctx.root, { queue, subject: { to: to as Ref["to"], rel: "input" }, decider, ask, slug: to.split("/")[1]! }, at, dedupe).entry;
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
    if (accepts && entry.queue === "queue.pick" && subject) {
      const pin = await ctx.hooks.code({ runId: state.runId, step: step.id, cli: `clossys pin ${refOf(subject)} ${option!.candidate} --by owner:${entryName(entry)}`, argv: ["pin", refOf(subject), option!.candidate!, "--by", `owner:${entryName(entry)}`], ref: refOf(subject) });
      exit = pin.exit; wrote = pin.wrote ?? [];
    }
    state.vars.entry = entryName(entry);
    recordStep(ctx, step, { by: "human", who: "owner", raise: decider.raise }, filled, exit, wrote, vars);
    if (exit !== 0) return stop(ctx, `the owner answered ${answer} on ${waiting.entry}`, exit === 2 ? 2 : 0);
    state.cursor++;
    saveState(root, state);
    return null;
  }
  const at = iso(ctx.now());
  const to = subject ? refOf(subject) : state.publication ? `publisher/release.${state.publication}` : undefined;
  if (!to) return stop(ctx, `step ${step.id} needs a slot or a publication to ask about`, 2);
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
    options = release
      ? [{ id: "ready", ...(manifest ? { candidate: manifest as NonNullable<QueueEntry["options"]>[number]["candidate"] } : {}), summary: `mark ${manifest ?? "the manifest"} ready` }, { id: "not-ready", summary: "keep the current ready pin" }]
      : [{ id: "approve", summary: `confirm the agent's pick for ${to}` }, { id: "reject", summary: "keep looking" }];
    fallback = release ? "not-ready" : null;
  }
  const { entry } = raiseEntry(root, {
    queue: decider.raise, subject: { to: to as Ref["to"], rel: "input" }, decider: "owner", ask: `${step.does} (${to})`,
    slug: to.split("/")[1]!, default: fallback, ...(options ? { options } : {}), ...(refs ? { refs } : {}),
  }, at, false);
  state.raised.push(entryName(entry));
  state.status = "waiting"; state.waiting = { step: step.id, on: "entry", entry: entryName(entry), then: "continue" };
  saveState(root, state);
  return { exitCode: 0, state, entry: entryName(entry), message: `run ${state.runId}: ${step.id} waits for the owner on ${entryName(entry)}` };
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
  const last = state.steps[state.steps.length - 1];
  const ready = state.loop === "loop.release" && last?.exit === 0 && state.checks["release.ready"] === "pass";
  const subject = subjectOf(ctx);
  // The entries this run answers: the one it started from and the fixes it raised on the way (code close, answered by the slot).
  if (subject) {
    for (const name of [state.from, ...state.raised].filter((n): n is string => n !== undefined)) {
      const entry = readEntry(root, name);
      if (!entry || entry.status !== "open" || (entry.queue !== "queue.fix" && entry.queue !== "queue.clarify")) continue;
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

function writeLedger(ctx: Context, status: RunState["status"] & LedgerEntry["status"], outcome: string, exitCode: Exit): RunResult {
  const { root, state } = ctx;
  const at = iso(ctx.now());
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
  const fd = openSync(file, "wx");
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
    const outcome = await hooks.code({ runId: state.runId, step: step.id, cli: step.cli, argv: step.cli.split(" ").slice(1) });
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
