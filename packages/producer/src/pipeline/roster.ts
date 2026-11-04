/**
 * WHO holds each pipeline step: the canvas's lanes and the Content overview's team strip.
 *
 * The roster is declared once here, from the slot agents: You (the owner), each content agent, and
 * Checks (the code that verifies). A step's holder comes from its seat file
 * (clossys/agents/producer/<step>/seat.json) when one exists; otherwise it is derived from the step:
 *   decide:judgment  You
 *   decide:creative  the agent the step names (actor agent:<name>), at its tier once a seat names one
 *   plumb            Code: Checks for a check-stage step, otherwise Publisher (it assembles and serves)
 * A derived holder is marked `derived`. Lanes are never listed by hand: they are the roster in order,
 * plus `unassigned` while any step has no holder. A holder that is not a roster entry fails
 * check:pipeline (lane.unrostered).
 */
import { SLOT_AGENTS } from "../records/slot-model/types.js";
import type { Step } from "./define.js";
import type { SeatReport } from "./seats.js";

/** You, then the slot agents, then Checks. */
export const ROSTER = Object.freeze(["you", ...SLOT_AGENTS, "checks"] as const);
export type RosterId = typeof ROSTER[number];
/** The lane a step without a holder sits in, shown as open work. Not a roster entry. */
export const UNASSIGNED = "unassigned";

/** You decide; an AI agent drafts; Code runs deterministically. */
export type SeatKind = "you" | "ai" | "code";
export type SeatTier = "low" | "mid" | "high";

export interface Holder {
  /** A roster id; `unassigned` when no holder resolves; any other value is unrostered. */
  readonly id: string;
  readonly kind: SeatKind | null;
  /** `file` when the step's seat file names the holder, `derived` when it comes from the step. */
  readonly source: "file" | "derived";
  /** The AI tier the seat file names; null when no seat names one. */
  readonly tier: SeatTier | null;
}

export interface RosterEntry {
  readonly id: RosterId;
  /** The seat kinds this entry holds steps as, in You, AI, Code order. */
  readonly kinds: readonly SeatKind[];
  readonly steps: number;
  /** Where its holds come from: file, derived, or both. */
  readonly sources: readonly ("file" | "derived")[];
  /** The AI tiers its seat files name. */
  readonly tiers: readonly SeatTier[];
}

export const isRostered = (id: string): id is RosterId => (ROSTER as readonly string[]).includes(id);

/** A seat file's `by` as a holder id: owner is You, agent:<name> is that agent, anything else stays as written. */
export function holderIdOf(by: string): string {
  if (by === "owner") return "you";
  if (by.startsWith("agent:")) return by.slice("agent:".length);
  return by;
}

/** The kind a roster id holds a step as. */
function kindOf(id: string, step: Pick<Step, "kind">): SeatKind | null {
  if (id === "you") return "you";
  if (id === "checks") return "code";
  if ((SLOT_AGENTS as readonly string[]).includes(id)) return step.kind === "plumb" ? "code" : "ai";
  return null;
}

export function holderOf(step: Pick<Step, "kind" | "actor" | "stage">, seat: SeatReport | null | undefined): Holder {
  if (seat && seat.state !== "invalid" && seat.by) {
    const id = holderIdOf(seat.by);
    const tier = seat.llm !== "open" && seat.llm ? seat.llm.tier : null;
    return { id, kind: kindOf(id, step), source: "file", tier };
  }
  let id: string = UNASSIGNED;
  if (step.kind === "decide:judgment") id = "you";
  else if (step.kind === "decide:creative") id = step.actor.startsWith("agent:") ? holderIdOf(step.actor) : step.actor === "owner" ? "you" : UNASSIGNED;
  else if (step.kind === "plumb") id = step.stage === "check" ? "checks" : "publisher";
  return { id, kind: id === UNASSIGNED ? null : kindOf(id, step), source: "derived", tier: null };
}

/** Every roster entry with what it holds (entries holding nothing stay listed, with zero steps). */
export function rosterOf(holders: readonly Holder[]): RosterEntry[] {
  const order: SeatKind[] = ["you", "ai", "code"];
  return ROSTER.map(id => {
    const held = holders.filter(holder => holder.id === id);
    return {
      id,
      kinds: order.filter(kind => held.some(holder => holder.kind === kind)),
      steps: held.length,
      sources: (["file", "derived"] as const).filter(source => held.some(holder => holder.source === source)),
      tiers: (["low", "mid", "high"] as const).filter(tier => held.some(holder => holder.tier === tier)),
    };
  });
}

/** The lanes, top to bottom: every roster entry, then `unassigned` while any holder is not a roster entry. */
export function laneIds(holders: readonly Holder[]): string[] {
  return [...ROSTER, ...(holders.some(holder => !isRostered(holder.id)) ? [UNASSIGNED] : [])];
}

/** The lane a holder sits in: its roster entry, else `unassigned`. */
export const laneOf = (holder: Holder): string => isRostered(holder.id) ? holder.id : UNASSIGNED;
