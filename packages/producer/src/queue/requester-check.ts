/**
 * The requester check a change or fix entry must pass before it closes (foundry-build-0048 U7, Closure): when the
 * handler's work is done, code re-runs the requester slot's checks. A pass closes the entry; a fail records
 * `rejected` and the entry stays open with its handler.
 *
 * The slots judged: the requester slot (`from`, when it is a slot ref) and, for a fix, the broken slot (`target`); a
 * change from the owner judges its target. Each one passes when:
 * - it is a placed consumer slot whose slot.json reads as clossys.slot/2 and is not marked needs-refresh;
 * - it resolves (pins.resolve: a pin, or a package default, for the slot and every record of a pin-map slot);
 * - every pinned candidate certifies on the pinSet now: a fresh recorded verdict is taken, a stale or legacy one is
 *   re-judged (certify, the slot's own contract checks), and a failed one fails.
 */
import { AGENT_LISTS } from "../agent-lists.generated.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { briefTightenOnly } from "../check/brief-tighten-only.js";
import { iaOrphans } from "../check/ia-orphans.js";
import { loopReachable } from "../check/loop-reachable.js";
import { checkPinsResolve, PINS_RESOLVE } from "../check/pins-resolve.js";
import { recordsComputedMatch } from "../check/records-computed-match.js";
import { checkRefsDangling, REFS_DANGLING } from "../check/refs-dangling.js";
import { pinChecks, reverdictOf, slotStatus, NEEDS_REFRESH } from "../constitution/cascade.js";
import { certifyEnv } from "../constitution/certify/index.js";
import { buildContext } from "../constitution/context.js";
import { liveSlotRecords } from "../constitution/checks/shared.js";
import { currentStandardOf, isAgentLoop, isLoopAgent } from "../loop/agent-loops.js";
import { readSubject } from "../loop/slots.js";
import { parseCandidateName } from "../records/candidate.js";
import { isRecordSlot, resolveSlot, slotRecords } from "../records/resolve.js";
import { SLOT_LOCK } from "../records/slot-write.js";
import { pinGate } from "../constitution/pin-gate.js";
import { readRequest, requestLockPath, resultRefusal, targetOf } from "../records/request.js";
import { isReleaseSlot } from "../release/pins.js";
import type { AgentId, OwnerOption, SlotRequest } from "../records/types.js";
import { consumerFacts, routeEntry, RoutingError } from "./routing.js";

const SLOT_REF = new RegExp(String.raw`^(${AGENT_LISTS.content.join("|")})\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})$`);

export interface RequesterCheck {
  readonly ok: boolean;
  /** The slots judged, in order. */
  readonly slots: readonly string[];
  /** Why it fails; empty on a pass. */
  readonly failures: readonly string[];
}

/** The slots a closing entry's requester check judges. */
export function requesterSlots(entry: { readonly kind: string; readonly from: string; readonly target: string }): string[] {
  const out: string[] = [];
  if (SLOT_REF.test(entry.from)) out.push(entry.from);
  if ((entry.kind === "fix" || !out.length) && SLOT_REF.test(entry.target) && !out.includes(entry.target)) out.push(entry.target);
  return out;
}

/**
 * The pinSet now of every pinned candidate the requester check judges, one `<slot>[#<record>] <candidate> <pinSet>` line
 * each, sorted: the upstream pins a certification reads (certify pinSetOf). records/request.ts inputsSha256 binds them
 * with the requester's own files, so a repin upstream after an honest close is drift (slots.stale's), not a Q7 red.
 */
export function requesterPinSets(root: string, entry: { readonly kind: string; readonly from: string; readonly target: string }): string[] {
  const slots = requesterSlots(entry);
  if (!slots.length) return [];
  const judged = new Set(slots);
  const ctx = buildContext(root, join(root, "clossys"), { focus: slots.map(ref => ({ agent: ref.split("/")[0]!, slot: ref.split("/")[1]! })) });
  const records = [...liveSlotRecords(ctx)].filter(slot => judged.has(`${slot.agent}/${slot.id}`));
  return pinChecks(ctx, certifyEnv(ctx), records)
    .map(check => `${check.slot.agent}/${check.slot.id}${check.record !== undefined ? `#${check.record}` : ""} ${check.candidate.name} ${check.current}`)
    .sort();
}

/** Re-runs the requester slot's checks for a closing change or fix entry (`root` is the folder holding clossys/). */
export function requesterCheck(root: string, entry: { readonly kind: string; readonly from: string; readonly target: string }): RequesterCheck {
  const slots = requesterSlots(entry);
  const failures: string[] = [];
  if (!slots.length) return { ok: false, slots, failures: [`${entry.from} -> ${entry.target}: no requester slot to re-check`] };
  for (const ref of slots) {
    const [agent, slotId] = ref.split("/") as [AgentId, string];
    const subject = readSubject(root, agent, slotId);
    if (!subject) { failures.push(`${ref}: no clossys.slot/2 slot.json to re-check`); continue; }
    if (subject.slot.status === NEEDS_REFRESH) failures.push(`${ref}: is needs-refresh (its loop.choose or loop.create judges it again)`);
    const records = isRecordSlot(root, agent, slotId) ? slotRecords(root, agent, slotId) : [undefined];
    if (!records.length) failures.push(`${ref}: a record slot with no pinned record and no package default`);
    for (const record of records) {
      const resolution = resolveSlot(root, agent, slotId, record);
      if (resolution.state === "unresolved") failures.push(`${ref}${record !== undefined ? `#${record}` : ""}: does not resolve (${resolution.pinIssue ?? resolution.reason})`);
      else if (resolution.state === "sample" && resolution.pinIssue) failures.push(`${ref}${record !== undefined ? `#${record}` : ""}: ${resolution.pinIssue}`);
    }
  }
  const judged = new Set(slots);
  const ctx = buildContext(root, join(root, "clossys"), { focus: slots.map(ref => ({ agent: ref.split("/")[0]!, slot: ref.split("/")[1]! })) });
  const records = [...liveSlotRecords(ctx)].filter(slot => judged.has(`${slot.agent}/${slot.id}`));
  const env = certifyEnv(ctx);
  for (const check of pinChecks(ctx, env, records)) {
    const label = `${check.slot.agent}/${check.slot.id}${check.record !== undefined ? `#${check.record}` : ""}`;
    if (slotStatus(check.slot) === NEEDS_REFRESH) continue;
    if (check.state === "fresh") continue;
    if (check.state === "failed") { failures.push(`${label}: pinned ${check.candidate.name} fails its verdict on the pinSet now`); continue; }
    const verdict = reverdictOf(check, env);
    if (!verdict.certified) failures.push(`${label}: pinned ${check.candidate.name} does not certify on the pinSet now (${verdict.reasons.slice(0, 2).map(reason => JSON.stringify(reason)).join("; ")})`);
  }
  return { ok: failures.length === 0, slots, failures };
}

/** A fix entry as its check re-runs it: the fixed slot, the check, and the refs naming the entry it was raised on. */
export interface FixEntry {
  readonly target: string;
  readonly check?: string;
  readonly refs?: readonly { readonly to: string; readonly record?: string; readonly rel: string }[];
}
type Finding = { readonly subject: string; readonly detail: string };

/**
 * The change entry a fix raised on a failed owner answer cites (records/request.ts failedStep), read as an entry, and
 * the option its latest owner answer chose. A finding on the fix's target when it cites none, or the entry is gone.
 */
function citedAnswer(root: string, entry: FixEntry): { change: SlotRequest; option?: OwnerOption } | Finding {
  const cite = entry.refs?.find(ref => ref.to === "producer/queue.change" && ref.rel === "cites" && ref.record !== undefined);
  if (!cite) return { subject: entry.target, detail: "the fix cites no producer/queue.change entry whose answer failed" };
  let change: SlotRequest;
  try { change = readRequest(join(root, "clossys"), cite.record!); } catch (error) {
    return { subject: entry.target, detail: `queue.change#${cite.record} does not read: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (change.kind !== "change" || change.target !== entry.target) return { subject: entry.target, detail: `queue.change#${cite.record} is no change on ${entry.target}` };
  const answered = change.events.filter(event => event.op === "answered" && event.by === "owner").at(-1);
  const option = change.options?.find(item => item.id === answered?.option);
  return option ? { change, option } : { change };
}
const isFinding = (value: object): value is Finding => "detail" in value;

type PinStep = { readonly verb: "pin"; readonly args: readonly string[] };
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

/** The pin gate (constitution/pin-gate.ts, no write) on the candidate a pin step names, its refusals on the fix's target. */
function pinGateFindings(root: string, entry: FixEntry, step: PinStep): Finding[] {
  const [agent, slotId] = step.args[0]!.split("/") as [string, string];
  const gate = pinGate(root, join(root, "clossys"), agent, slotId.split("#")[0]!, step.args[1]!, nowIso());
  return gate.refusals.map(detail => ({ subject: entry.target, detail: `pin gate on ${step.args[1]}: ${detail}` }));
}

/**
 * The pin verb's own rules (cli/pin.ts runTargetPin) that hold whoever runs the pin, re-run with no write, then the pin
 * gate: the slot is a clossys.slot/2 target slot, the candidate is a candidate file name, the slot is no release slot
 * (a ready-pin answers queue.approve through release.ready, never a change answer), its write lock is free, an agent
 * loop's Producer standard reads, and the gate passes. The answer binding (the owner's answer as the change's last
 * event) is the owner's to give again, not a check the fix's assignee can make pass.
 */
function pinStepFindings(root: string, entry: FixEntry, step: PinStep): Finding[] {
  const on = (detail: string): Finding => ({ subject: entry.target, detail: `pin ${step.args[0]} ${step.args[1]}: ${detail}` });
  const [agent, target] = step.args[0]!.split("/") as [AgentId, string];
  const slotId = target.split("#")[0]!;
  const record = target.includes("#") ? target.slice(target.indexOf("#") + 1) : undefined;
  if (!readSubject(root, agent, slotId)) return [on(`${agent}/${slotId} has no clossys.slot/2 slot.json`)];
  if (!parseCandidateName(step.args[1]!)) return [on(`${step.args[1]} is not a candidate file name (<name>-v<n>.md|json|svg)`)];
  if (agent === "publisher" && isReleaseSlot(agent, slotId) && record === undefined) return [on("a release slot takes its ready-pin through an owner answer on queue.approve (release.ready), not a change answer")];
  const out: Finding[] = [];
  const lock = join(root, "clossys", "agents", agent, slotId, SLOT_LOCK);
  if (existsSync(lock)) out.push(on(`the slot's write lock ${lock} is held (another decision write is running; if none is, remove it by hand)`));
  if (isLoopAgent(agent) && isAgentLoop(slotId) && record === undefined) {
    const standard = currentStandardOf(root, slotId);
    if (!standard.ok) out.push(on(`producer/${slotId} cannot be read: ${standard.reason}`));
  }
  return [...out, ...pinGateFindings(root, entry, step)];
}

/**
 * The closure an owner answer's step ends in (records/request.ts runAnswer, closeWork), re-run on the cited change with
 * no write: passes when the change has closed since; else its entry lock is free and, by the step's verb, a handoff
 * routes (any router error a finding), a pin's step passes (pinStepFindings) and its result resolves and requester
 * check passes, a close's result resolves and (unless declined) its requester check passes. A reject only needs the lock.
 */
function closureFindings(root: string, entry: FixEntry): Finding[] {
  const cited = citedAnswer(root, entry);
  if (isFinding(cited)) return [cited];
  const { change, option } = cited;
  if (change.status !== "open") return [];
  const on = (detail: string): Finding => ({ subject: entry.target, detail: `closure of queue.change#${change.id}: ${detail}` });
  const step = option?.then;
  if (!step) return [on("its latest owner answer names no option")];
  const consumer = join(root, "clossys");
  const out: Finding[] = [];
  const lock = requestLockPath(consumer, change.id);
  if (existsSync(lock)) out.push(on(`the entry is locked by another writer (${lock}; if none is running, remove it by hand)`));
  if (step.verb === "handoff") {
    try { out.push(...ANSWER_RUNNERS.route!(root, entry)); } catch (error) { out.push(on(`the router fails: ${error instanceof Error ? error.message : String(error)}`)); }
    return out;
  }
  if (step.verb === "reject") return out;
  const outcome = step.verb === "close" ? step.args[0] : "changed";
  const result = step.verb === "pin" ? step.args[0]! : outcome === "fixed" ? change.target : `queue.change#${change.id}`;
  if (step.verb === "pin") out.push(...pinStepFindings(root, entry, step as PinStep));
  const why = resultRefusal(consumer, result);
  if (why) out.push(on(`result ${result} ${why}`));
  if (outcome !== "declined") out.push(...requesterCheck(root, change).failures.map(detail => on(`requester check: ${detail}`)));
  return out;
}

/**
 * The answer-step checks (foundry-build-0048 U7 r5 blind1 B3, r7): a fix raised on a failed owner answer re-runs the
 * check that refused the answer's step, on the change entry it cites, so it can close fixed. Every label
 * records/request.ts StepFailure gives has one, so no failed step's fix turns into an owner question.
 * - `pin.gate`: the pin gate (constitution/pin-gate.ts, no write) on the candidate the latest answer pins.
 * - `pin`: the pin verb's own rules that hold whoever pins (pinStepFindings), then the pin gate.
 * - `requester.check`: the requester check of the cited change.
 * - `route`: the router, the owner reservation set aside, routes the cited change to the agent the latest answer hands it to.
 * - `closure`: the closure the step ends in (closureFindings).
 */
const ANSWER_RUNNERS: Readonly<Record<string, (root: string, entry: FixEntry) => readonly Finding[]>> = {
  "pin.gate": (root, entry) => {
    const cited = citedAnswer(root, entry);
    if (isFinding(cited)) return [cited];
    const step = cited.option?.then;
    if (step?.verb !== "pin") return [{ subject: entry.target, detail: `the latest answer on queue.change#${cited.change.id} pins nothing` }];
    return pinGateFindings(root, entry, step as PinStep);
  },
  pin: (root, entry) => {
    const cited = citedAnswer(root, entry);
    if (isFinding(cited)) return [cited];
    const step = cited.option?.then;
    if (step?.verb !== "pin") return [{ subject: entry.target, detail: `the latest answer on queue.change#${cited.change.id} pins nothing` }];
    return pinStepFindings(root, entry, step as PinStep);
  },
  "requester.check": (root, entry) => {
    const cited = citedAnswer(root, entry);
    if (isFinding(cited)) return [cited];
    return requesterCheck(root, cited.change).failures.map(detail => ({ subject: entry.target, detail: `requester check of queue.change#${cited.change.id}: ${detail}` }));
  },
  route: (root, entry) => {
    const cited = citedAnswer(root, entry);
    if (isFinding(cited)) return [cited];
    const step = cited.option?.then;
    if (step?.verb !== "handoff") return [{ subject: entry.target, detail: `the latest answer on queue.change#${cited.change.id} hands it to no agent` }];
    try {
      const route = routeEntry(consumerFacts(join(root, "clossys")), { kind: "change", target: cited.change.target, assignee: targetOf(cited.change)!.agent }, { delegated: true });
      return route.assignee === step.args[0] ? [] : [{ subject: entry.target, detail: `the table, the owner reservation set aside, routes ${cited.change.target} to ${route.assignee}, not ${step.args[0]}` }];
    } catch (error) {
      if (!(error instanceof RoutingError)) throw error;
      return [{ subject: entry.target, detail: `the router refuses ${cited.change.target}: ${error.message}` }];
    }
  },
  closure: closureFindings,
};

/**
 * The checks a fix entry can name that Producer re-runs when the fix closes as fixed (foundry-build-0048 U7): the
 * slot/2 tree checks, loop.reachable, refs.dangling (the strict set) and pins.resolve, each run over the tree, its
 * findings on the fixed slot (`<agent>/<slot>`, a record of it, a candidate of it or a file under it) why it fails;
 * and the answer-step checks (ANSWER_RUNNERS), whose findings are on the fixed slot.
 */
const FIX_RUNNERS: Readonly<Record<string, (root: string, entry: FixEntry) => readonly Finding[]>> = {
  [briefTightenOnly.id]: root => briefTightenOnly.run(root).findings,
  [recordsComputedMatch.id]: root => recordsComputedMatch.run(root).findings,
  [iaOrphans.id]: root => iaOrphans.run(root).findings,
  [loopReachable.id]: root => loopReachable.run(root).findings,
  [REFS_DANGLING]: root => checkRefsDangling(root).findings,
  [PINS_RESOLVE]: root => checkPinsResolve(root).findings,
  ...ANSWER_RUNNERS,
};
export const FIX_CHECKS: readonly string[] = Object.keys(FIX_RUNNERS).sort();

/** Re-runs a fix entry's own check on its target: `ran` false when the check is none Producer can re-run (a fix cannot close fixed then). */
export function fixCheck(root: string, entry: FixEntry): { readonly ran: boolean; readonly failures: readonly string[] } {
  const run = entry.check !== undefined ? FIX_RUNNERS[entry.check] : undefined;
  if (!run) return { ran: false, failures: [] };
  const head = entry.target.split("#")[0]!;
  const on = (subject: string) => subject === head || subject.startsWith(`${head}#`) || subject.startsWith(`${head}/`) || subject.includes(`agents/${head}/`);
  return { ran: true, failures: run(root, entry).filter(finding => on(finding.subject)).map(finding => `${finding.subject}: ${finding.detail}`) };
}
