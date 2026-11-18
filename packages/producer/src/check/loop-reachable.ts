/**
 * `loop.reachable` (flows.md 4, producer.md 3 and 10.4.1): a loop version is runnable only when
 *
 * - its content is a `clossys.loop-version/1` (every step has an id, a `does`, a decider, a cli, reads, writes, checks);
 * - every decider is code, one of the five live agents (or `<owner of slot>`, filled per slot by `clossys run`) or the owner;
 * - a package version names no `model` (system.md 14.6: package loops carry `tier` only);
 * - step ids are unique and every `onFail.then` is `retry` or one of the loops;
 * - its triggers are a non-empty subset of the loop's triggers (flows.md 2), so the exit is reached from a trigger
 *   the loop answers to;
 * - every `when` names known slots and IA paths (the package IA, plus the consumer's slots), so no step it guards is
 *   unreachable;
 * - each exit check (`EXIT_CHECKS`) sits on a step with no `when`, or on steps whose `when` names only request decisions
 *   and together name every decision (loop.slot: place on create, link on reuse), so no slot or run can end the loop
 *   without it (the run's finish verifies it in the files either way); a
 *   human `queue.pick` step with a `when` is the pinning step of the slots it matches (OWNER_PICK_RAISE): it checks
 *   `pins.resolve` itself and comes before the agent `pick` step, which does not run for those slots;
 * - `loop.fill` writes candidates (`create-candidates`) before its first pinning step;
 * - `loop.release` ends on the ready-pin: its last step checks `release.ready`, has no `when`, is written by code
 *   (never an agent), comes after an owner `queue.approve` sign-off with no `when`, and nothing runs after it;
 *   compile, build and gates run for every publication before the sign-off.
 *
 * The check runs over the version each loop would run (the consumer pin, which must be the owner's, else package v1)
 * and the package v1 itself. The loader (loop/version.ts) and `clossys run` refuse a version this check fails, and
 * `clossys check` reports its findings.
 */
import { validateAgainst } from "../records/schema.js";
import { recordSchema, treeResult, type TreeCheck, type TreeCheckResult, type TreeFinding } from "../records/slot.js";
import type { LoopStep } from "../records/types.js";
import { readConsumerLoop, readPackageLoop } from "../loop/files.js";
import { knownSlots, unreachableWhen, type KnownSlots } from "../loop/known-slots.js";
import { AGENT_PICK_VERB, EXIT_CHECKS, LIVE_AGENTS, LOOP_NAMES, LOOP_TRIGGERS, OWNER_OF_SLOT, OWNER_PICK_RAISE, RELEASE_BEFORE_SIGNOFF, RELEASE_READY, isLoopName, type LoopName } from "../loop/names.js";

export const LOOP_REACHABLE = "loop.reachable";

export interface ReachableOptions {
  /** A package version (`packages/producer/loops/`): no `model` on any decider. */
  readonly packageVersion?: boolean;
  /** The slots and IA paths a `when` may name; default: the package IA (no consumer slots). */
  readonly known?: KnownSlots;
}

const PINS_RESOLVE = "pins.resolve";
/** The decisions a request takes (`when.decision`): a step per decision covers every request. */
const REQUEST_DECISIONS = ["reuse", "create"] as const;
const isOwnerPick = (step: LoopStep): boolean => step.decider.by === "human" && step.decider.raise === OWNER_PICK_RAISE;
const isAgentPick = (step: LoopStep): boolean => step.decider.by === "agent" && step.decider.verb === AGENT_PICK_VERB;
const pins = (step: LoopStep): boolean => isOwnerPick(step) || isAgentPick(step) || step.checks.includes(PINS_RESOLVE);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The reasons `content` cannot run as `loop`; empty when it can. */
export function loopReachableIssues(loop: LoopName, content: unknown, options: ReachableOptions = {}): string[] {
  const issues: string[] = [];
  if (!isObject(content)) return [`${loop}: the version content is not an object`];
  const steps = Array.isArray(content.steps) ? content.steps as unknown[] : [];
  // Named first, so the reason reads plainly; the schema says the same in its own words.
  steps.forEach((step, index) => {
    const id = isObject(step) && typeof step.id === "string" ? step.id : `#${index}`;
    if (!isObject(step) || !isObject(step.decider)) issues.push(`${loop}: step ${id} names no decider`);
  });
  for (const issue of validateAgainst(recordSchema("loop-version.json"), content)) issues.push(`${loop}: schema ${issue.path} ${issue.message}`);
  if (issues.length) return issues;

  const version = content as unknown as { trigger: string[]; steps: LoopStep[] };
  const seen = new Set<string>();
  for (const step of version.steps) {
    if (seen.has(step.id)) issues.push(`${loop}: step id ${step.id} is used twice`);
    seen.add(step.id);
    const decider = step.decider;
    if (decider.by === "agent") {
      if (decider.agent !== OWNER_OF_SLOT && !LIVE_AGENTS.includes(decider.agent)) issues.push(`${loop}: step ${step.id} names ${String(decider.agent)}, not one of the five live agents or ${OWNER_OF_SLOT}`);
      if (options.packageVersion && "model" in decider) issues.push(`${loop}: step ${step.id} names a model (${String(decider.model)}); a package loop version carries tier only (system.md 14.6)`);
    }
    if (decider.by === "human" && decider.who !== "owner") issues.push(`${loop}: step ${step.id} is decided by ${String(decider.who)}, not the owner`);
    const then = step.onFail?.then;
    if (then !== undefined && then !== "retry" && !isLoopName(then)) issues.push(`${loop}: step ${step.id} onFail goes to ${then}, which is not retry or one of ${LOOP_NAMES.join(", ")}`);
  }

  const allowed = LOOP_TRIGGERS[loop];
  for (const trigger of version.trigger) if (!allowed.includes(trigger)) issues.push(`${loop}: trigger ${trigger} does not start ${loop} (it answers ${allowed.join(", ")})`);

  const known = options.known ?? knownSlots();
  for (const step of version.steps) {
    const unknown = unreachableWhen(step.when, known);
    if (unknown.length) issues.push(`${loop}: step ${step.id} can never run: its when names ${unknown.join(", ")}, which no known slot matches`);
  }

  const always = version.steps.filter(step => step.when === undefined);
  // Steps that run on a request decision only: together they run for every request when they name every decision.
  const byDecision = (check: string) => new Set(version.steps.filter(step => step.checks.includes(check) && step.when !== undefined
    && Object.keys(step.when).every(key => key === "decision")).flatMap(step => step.when!.decision ?? []));
  for (const check of EXIT_CHECKS[loop]) {
    if (always.some(step => step.checks.includes(check))) continue;
    const decided = byDecision(check);
    if (REQUEST_DECISIONS.every(decision => decided.has(decision))) continue;
    issues.push(`${loop}: the exit can be reached without ${check}: no step that runs for every slot checks it${decided.size ? ` (the decision steps checking it run on ${[...decided].join(", ")} only)` : ""}`);
  }
  // B1: an owner pick with a when pins its slots instead of the agent pick, so it checks pins.resolve and runs first.
  const firstAgentPick = version.steps.findIndex(isAgentPick);
  version.steps.forEach((step, index) => {
    if (!isOwnerPick(step) || step.when === undefined) return;
    if (EXIT_CHECKS[loop].includes(PINS_RESOLVE) && !step.checks.includes(PINS_RESOLVE)) issues.push(`${loop}: the exit can be reached without ${PINS_RESOLVE} for the slots ${step.id} picks: the owner's pick step must check it`);
    if (firstAgentPick >= 0 && firstAgentPick < index) issues.push(`${loop}: step ${version.steps[firstAgentPick]!.id} pins before the owner's pick (${step.id}); the owner picks those slots directly`);
  });

  if (loop === "loop.fill") {
    const create = version.steps.findIndex(step => step.decider.by === "agent" && step.decider.verb === "create-candidates" && step.when === undefined);
    const pin = version.steps.findIndex(pins);
    if (create < 0 || (pin >= 0 && pin < create)) issues.push(`${loop}: no create-candidates step for every slot runs before the first pinning step${pin >= 0 ? ` (${version.steps[pin]!.id})` : ""}`);
  }

  if (loop === "loop.release") {
    const last = version.steps[version.steps.length - 1]!;
    const ready = version.steps.findIndex(step => step.checks.includes(RELEASE_READY));
    if (!last.checks.includes(RELEASE_READY) || last.when !== undefined) issues.push(`${loop}: the last step (${last.id}) must be the ready-pin (checks ${RELEASE_READY}, no when)`);
    else if (ready !== version.steps.length - 1) issues.push(`${loop}: ${RELEASE_READY} is checked before the last step; nothing runs after the ready-pin`);
    if (last.decider.by !== "code") issues.push(`${loop}: the ready-pin (${last.id}) is decided by ${last.decider.by}; code writes it from the owner's sign-off`);
    const signoff = version.steps.findIndex(step => step.when === undefined && step.decider.by === "human" && step.decider.raise === "queue.approve");
    if (signoff < 0 || signoff > version.steps.length - 2) issues.push(`${loop}: the ready-pin has no owner queue.approve sign-off before it`);
    for (const need of RELEASE_BEFORE_SIGNOFF) {
      const at = version.steps.findIndex(step => step.when === undefined && step.decider.by === "code" && need.cli.test(step.cli));
      if (at < 0 || (signoff >= 0 && at > signoff)) issues.push(`${loop}: ${need.id} (${need.cli.source}) does not run for every publication before the owner's sign-off`);
    }
  }
  return issues;
}

/** The tree check: each loop's running version (and every package v1) must be reachable. */
export function runLoopReachable(root: string): TreeCheckResult {
  const findings: TreeFinding[] = [];
  for (const loop of LOOP_NAMES) {
    const packaged = readPackageLoop(loop);
    if (!packaged.ok) findings.push({ subject: `producer/${loop}`, detail: packaged.reason });
    else for (const detail of loopReachableIssues(loop, packaged.content, { packageVersion: true })) findings.push({ subject: packaged.ref, detail });
    const running = readConsumerLoop(root, loop);
    if (running === undefined) continue;
    if (!running.ok) { findings.push({ subject: `producer/${loop}`, detail: running.reason }); continue; }
    for (const detail of loopReachableIssues(loop, running.content, { known: knownSlots(root) })) findings.push({ subject: running.ref, detail });
  }
  return treeResult(LOOP_REACHABLE, findings);
}

export const loopReachable: TreeCheck = { id: LOOP_REACHABLE, run: runLoopReachable };
