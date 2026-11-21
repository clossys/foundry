/**
 * When code may pin a slot (DET-STEPS round 2, planner D5 "Pick = A"): basis `scorecard`, decidedBy `code:scorecard`.
 * Code pins only what a fixed rule settles; every other pick stays the agent seat's (or the owner's) judgment.
 *
 * - The slot has no owner-pick (`queue.pick`) or confirm (`queue.approve`) step: no human step of that kind whose
 *   `when` matches the slot, in any loop version the consumer runs for the slot's agent that holds an agent pick
 *   step (loop.choose, loop.fill, loop.refine, or a consumer version of another loop). A loop version that cannot
 *   be read refuses: code never pins a slot it cannot prove is free of owner steps.
 * - The slot is a whole slot, not a Writer pin map: each pin-map record is the agent's pick.
 * - The slot holds no owner or planner decision: a held pin that is `pinned` (an owner pick, an owner-confirmed agent
 *   pick) or whose basis is picked, bulk or planner is never replaced by code.
 * - The pick is the scorecard's single top row: submitted and certified, and strictly ahead of every other submitted,
 *   certified row (fewer reasons). Two passing rows with the same reasons are a tie, and a tie is the agent's pick.
 *
 * `clossys pin --by code:scorecard` refuses on any of these under the slot lock, after the pin gate has judged the
 * pick (cli/pin.ts); `clossys settle pick` asks the same questions first and hands the step to the agent when code may
 * not decide.
 */
import { join } from "node:path";
import type { Scorecard } from "../constitution/pin-gate.js";
import { readPinFile } from "../records/pin-map.js";
import { OWNER_BASES, pinRecordStatus } from "../records/pin.js";
import { isRecordSlot } from "../records/resolve.js";
import type { AgentId, LoopVersion } from "../records/types.js";
import { AGENT_PICK_VERB, LOOP_NAMES, OWNER_PICK_RAISE } from "./names.js";
import { readSubject, whenMatches } from "./slots.js";
import { loadLoopVersion } from "./version.js";

/** The queue a confirm step raises: the owner approves the agent's pick. */
export const CONFIRM_RAISE = "queue.approve";

const picks = (version: LoopVersion): boolean => version.steps.some(step => step.decider.by === "agent" && step.decider.verb === AGENT_PICK_VERB);

/** Why the slot has an owner step code must leave to the owner, or undefined when it has none. */
export function ownerStepRefusal(root: string, agent: AgentId, slotId: string): string | undefined {
  const subject = readSubject(root, agent, slotId);
  if (!subject) return `${agent}/${slotId} has no clossys.slot/2 slot.json, so its owner steps cannot be matched; code pins only a slot it can prove has none`;
  for (const loop of LOOP_NAMES) {
    const load = loadLoopVersion(root, loop, agent);
    if (!load.ok) return `${loop} cannot be read (${load.reason}), so ${agent}/${slotId} cannot be proved free of an owner-pick or confirm step`;
    const version = load.loaded.content;
    if (!picks(version)) continue;
    for (const step of version.steps) {
      if (step.decider.by !== "human" || (step.decider.raise !== OWNER_PICK_RAISE && step.decider.raise !== CONFIRM_RAISE)) continue;
      if (whenMatches(step.when, subject)) return `${agent}/${slotId} has the ${step.decider.raise === OWNER_PICK_RAISE ? "owner-pick" : "confirm"} step ${loop}/${step.id} (${step.decider.raise}); its pick is the owner's, never code's`;
    }
  }
  return undefined;
}

/** Why the held pin is a human decision code may not replace, or undefined. */
export function heldDecisionRefusal(root: string, agent: AgentId, slotId: string, record?: string): string | undefined {
  const held = readPinFile(join(root, "clossys", "agents", agent, slotId, "pin.json"), { agent, slotId });
  const at = `${agent}/${slotId}${record !== undefined ? `#${record}` : ""}`;
  if (held.kind === "none") return undefined;
  // A pin code cannot read as a valid pin/2 (an int2 pin/1, an unknown schema, broken JSON, or a pin/2 or pin map
  // with issues) may hold an owner or planner decision: code never replaces it, it waits for the migration or the fix.
  if (held.kind === "pin/1" || held.kind === "invalid" || held.issues.length) {
    return `${at} holds a pin.json code cannot read as a valid clossys.pin/2 (${held.issues.join("; ")}); code never replaces a pin it cannot read`;
  }
  const pin = held.kind === "pin" ? held.doc : record !== undefined ? held.doc.records[record] : undefined;
  if (!pin) return undefined;
  if (pinRecordStatus(pin) === "pinned" || OWNER_BASES.includes(pin.basis) || pin.basis === "planner") {
    return `${at} holds ${pin.candidate} decided by ${pin.decidedBy} (${pin.basis}); code never replaces an owner or planner decision`;
  }
  return undefined;
}

/** Why `pick` is not the scorecard's single top row, or undefined when it is. */
export function scorecardTopRefusal(scorecard: Scorecard, pick: string): string | undefined {
  const passing = scorecard.candidates.filter(row => row.submitted && row.certified);
  const [top, next] = passing;
  if (!top) return "the scorecard has no submitted, certified row";
  if (top.candidate !== pick) return `${pick} is not the scorecard's top row (${top.candidate} is)`;
  if (next && next.reasons.length <= top.reasons.length) return `the scorecard's top is a tie (${top.candidate} and ${next.candidate} both pass with ${top.reasons.length} reason(s)); a tie is the agent's pick`;
  return undefined;
}

/**
 * Every reason the slot is not code's to pin, whatever its candidates: a Writer pin-map record (each record is the
 * agent's pick), an owner-pick or confirm step, or a held owner or planner decision. Empty when code may pin it once
 * the gate passes its scorecard's single top row (scorecardTopRefusal).
 */
export function codeSlotRefusals(root: string, agent: AgentId, slotId: string, record?: string): string[] {
  const out: string[] = [];
  if (record !== undefined || isRecordSlot(root, agent, slotId)) out.push(`${agent}/${slotId}${record !== undefined ? `#${record}` : ""} is a pin-map slot; code pins whole slots only, and each record is the agent's pick`);
  const owner = ownerStepRefusal(root, agent, slotId);
  if (owner !== undefined) out.push(owner);
  const held = heldDecisionRefusal(root, agent, slotId, record);
  if (held !== undefined) out.push(held);
  return out;
}
