/**
 * The agent loop certifier (R05, foundry-build-0048 U9a): a candidate of `<agent>/loop.<name>` fits its slot when
 * - the slot is one of a content agent's five loop slots and its contract names that loop and extends Producer's
 *   standard loop of the same name (`{loop, extends: "producer/<loop>"}`, contract-loop.schema.json),
 * - the candidate is a `clossys.candidate/1` JSON file of this slot whose `content` is a loop version,
 * - that version extends the standard (it keeps every required step in order, with its decider, exit checks,
 *   failure routes and owner-class `when` data, and names no other agent) and can reach its exit
 *   (agent-loops.ts agentLoopIssues: loopExtensionIssues plus loop.reachable).
 * The standard of an agent loop slot is Producer's loop, not a `packages/<agent>/standards/` file: `standard: "loop"`.
 * With the consumer's root, that is the Producer loop the consumer runs now: its owner pin, else package v1 (U9a fix
 * round 4); the pin gate records it in the pin, and the runner refuses the pin once it is no longer the current one.
 */
import { validateValue, loadSchema } from "../../pipeline/schema.js";
import { agentLoopIssues, currentStandardOf, isAgentLoop, isLoopAgent, LOOP_KIND, LOOP_STANDARD } from "../../loop/agent-loops.js";
import type { CandidateRecord, SlotRecord } from "../types.js";
import { reason, type Reason } from "./types.js";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** True when the slot is a content agent's own loop slot (kind `loop` outside the Producer tree). */
export const isAgentLoopSlot = (slot: Pick<SlotRecord, "agent">, doc: Readonly<Record<string, unknown>>): boolean =>
  doc.kind === LOOP_KIND && isLoopAgent(slot.agent);

/** True when the slot record's slot.json is a content agent's loop slot: the rules about another kind's candidates (copy, registry lineage) do not read it. */
export const isAgentLoopRecord = (slot: Pick<SlotRecord, "agent" | "slot">): boolean => {
  const doc = slot.slot?.value;
  return isObject(doc) && isAgentLoopSlot(slot, doc);
};

/** Kind fit: the contract, the candidate header and the loop version against Producer's standard. */
export function certifyLoop(slot: SlotRecord, candidate: CandidateRecord, contract: Readonly<Record<string, unknown>>, root?: string): Reason[] {
  const agent = slot.agent, loop = slot.id;
  if (!isLoopAgent(agent) || !isAgentLoop(loop)) return [reason("invalid", `${agent}/${loop} is no agent loop slot (a content agent's loop.scope, loop.slot, loop.create, loop.choose or loop.cascade)`)];
  const out: Reason[] = validateValue(contract, loadSchema("contract-loop")).map(issue => reason("fixture", `contract${issue.path === "/" ? "" : issue.path} ${issue.message}`));
  if (contract.loop !== loop) out.push(reason("fixture", `contract.loop must be ${loop}, the slot's own id`));
  if (contract.extends !== `producer/${loop}`) out.push(reason("fixture", `contract.extends must be producer/${loop}, the standard loop it extends`));
  if (candidate.jsonError !== undefined || !isObject(candidate.json)) return [...out, reason("invalid", `${candidate.name} is not a JSON loop candidate${candidate.jsonError ? `: ${candidate.jsonError}` : ""}`)];
  const header = candidate.json.clossys;
  if (!isObject(header) || header.schema !== "clossys.candidate/1" || header.slot !== `${agent}/${loop}`) {
    out.push(reason("invalid", `${candidate.name} has no clossys.candidate/1 header naming ${agent}/${loop}`));
  }
  for (const issue of agentLoopIssues(agent, loop, candidate.json.content, { ...(root !== undefined ? { root } : {}) })) out.push(reason("standard", issue));
  return out;
}

/** The standard part of an agent loop slot: it names Producer's loop standard, and that standard loop is readable. */
export function loopStandardReasons(slot: SlotRecord, doc: Readonly<Record<string, unknown>>, root?: string): Reason[] {
  if (doc.standard === undefined) return [reason("no-standard", `slot ${slot.id} names no standard (slot.json standard "${LOOP_STANDARD}")`)];
  if (doc.standard !== LOOP_STANDARD) return [reason("standard", `an agent loop slot's standard is Producer's loop ("${LOOP_STANDARD}"), not ${String(doc.standard)}`)];
  if (!isAgentLoop(slot.id)) return [reason("standard", `${slot.id} has no Producer standard loop`)];
  const standard = currentStandardOf(root, slot.id);
  return standard.ok ? [] : [reason("standard", `Producer's standard ${slot.id} cannot be read: ${standard.reason}`)];
}

/** What a loop candidate's verdict reads beside its own bytes: the Producer standard loop it extends. */
export function loopStandardSha(loop: string, root?: string): string | null {
  if (!isAgentLoop(loop)) return null;
  const standard = currentStandardOf(root, loop);
  return standard.ok ? standard.file.sha256 : null;
}
