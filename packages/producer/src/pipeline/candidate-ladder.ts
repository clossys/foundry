/**
 * The candidate selection ladder (owner 2026-11-11): every `<agent>.candidates` submission says which
 * rung it came from, the same light record the Designer's source ladder keeps per roster row
 * (packages/designer/scripts/check-source-ladder.mjs: rung, chosen, reason), so there is one ladder
 * idea, not two.
 *
 *   select  a seed fits as it is: stock shadcn, a trusted free registry, an existing candidate or template;
 *   adapt   no seed fits as it is, so one seed is adapted;
 *   create  no seed can be adapted, so the candidate is new, with the reason no seed fit.
 *
 * The Designer climbs the source ladder itself: L1 stock shadcn@aria, L2 the most popular partner
 * registry part, L3 question the slot (merge or compose stock), L4 a Foundry part last. L1 and L2
 * select a seed, L3 adapts one, L4 creates. Its rungs are the source ladder's names.
 *
 * `clossys next <agent>/<slot> --submit` takes `--rung <rung> [--seed <id>] [--reason <text>]`, refuses
 * a submission whose record has an issue, and keeps the record in the run's decision.
 */
import type { SlotAgent } from "../records/slot-model/types.js";

export const GENERIC_RUNGS = ["select", "adapt", "create"] as const;
/** The Designer's rungs, in the source ladder's order (stock, partner, question, Foundry last). */
export const DESIGNER_RUNGS = ["L1", "L2", "L3", "L4"] as const;
export type GenericRung = typeof GENERIC_RUNGS[number];
export type LadderRung = GenericRung | typeof DESIGNER_RUNGS[number];

/** What each Designer rung does, as a generic rung. */
export const DESIGNER_RUNG_KIND: Readonly<Record<typeof DESIGNER_RUNGS[number], GenericRung>> = { L1: "select", L2: "select", L3: "adapt", L4: "create" };

export interface CandidateLadder {
  readonly rung: string;
  /** The seed selected or adapted: `shadcn@aria/<item>`, `<registry>/<item>`, `<slot>/<candidate>` or a template id. */
  readonly seed?: string;
  /** Why this rung: required to create (no seed fit), optional otherwise. */
  readonly reason?: string;
}
export interface LadderIssue { readonly rule: "missing-ladder" | "ladder-fields" | "create-justification"; readonly detail: string }

/** The rungs an agent's candidates climb, in order. */
export const rungsOf = (agent: SlotAgent | string): readonly string[] => agent === "designer" ? DESIGNER_RUNGS : GENERIC_RUNGS;
/** The generic rung a recorded rung stands for (a Designer rung maps through DESIGNER_RUNG_KIND). */
export function rungKind(agent: SlotAgent | string, rung: string): GenericRung | null {
  if (agent === "designer") return (DESIGNER_RUNG_KIND as Record<string, GenericRung>)[rung] ?? null;
  return (GENERIC_RUNGS as readonly string[]).includes(rung) ? rung as GenericRung : null;
}

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/**
 * The issues of one candidate's ladder record; empty when it may be recorded. Rule names follow the
 * source ladder: missing-ladder (no record), ladder-fields (a malformed field, a select or adapt
 * without its seed), create-justification (a created candidate without the reason no seed fit).
 */
export function ladderIssues(agent: SlotAgent | string, ladder: CandidateLadder | undefined): LadderIssue[] {
  const rungs = rungsOf(agent);
  if (!ladder) return [{ rule: "missing-ladder", detail: `a ${agent} candidate records its ladder rung (${rungs.join(" > ")})` }];
  const kind = rungKind(agent, ladder.rung);
  if (!kind) return [{ rule: "ladder-fields", detail: `rung must be one of ${rungs.join(", ")}, got ${JSON.stringify(ladder.rung)}` }];
  const issues: LadderIssue[] = [];
  if (ladder.seed !== undefined && !text(ladder.seed)) issues.push({ rule: "ladder-fields", detail: "seed must name the seed" });
  if (ladder.reason !== undefined && !text(ladder.reason)) issues.push({ rule: "ladder-fields", detail: "reason must say why" });
  if (kind !== "create" && !text(ladder.seed)) issues.push({ rule: "ladder-fields", detail: `rung ${ladder.rung} (${kind}) names the seed it ${kind === "select" ? "selected" : "adapted"}` });
  if (kind === "create" && !text(ladder.reason)) issues.push({ rule: "create-justification", detail: `rung ${ladder.rung} (create) records the reason no seed fit` });
  return issues;
}
