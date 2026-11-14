/**
 * R20 Director-derived (owner rule R-DIRECTOR-DERIVED; foundry-feedback-0016, foundry-audit-0005).
 * R17-R19 are reserved by slot-constitution.md (preview component, rendered correctness, requests),
 * so this rule takes the next free id. A downstream decision realises a Director decision, and the
 * pinned record says which one:
 * - R20.1 the pinned candidate of every Designer `themes.*` and `assets.*` slot cites, in
 *   meta.element.reason, a pinned Director slot (`director:<slot-id>`), or keeps an upstream default
 *   with `default:<ref>` plus a Director citation;
 * - R20.2 the same for the pinned candidate of every Writer slot, in its frontmatter `reason`.
 * `source.ref` alone does not satisfy it: it says where bytes came from, not what they realise.
 * The predicate is records/director-trace.ts, shared with `clossys design --check` and `clossys write --check`.
 */
import { candidateReason, directorTraceProblem, owesDirectorTrace } from "../../records/director-trace.js";
import type { ConstitutionContext, Row, RuleModule, SlotRecord } from "../types.js";
import { pinBlocker } from "./R02-pins-order.js";
import { allSlots, row } from "./shared.js";

/** Director slots whose pin is intact. */
export function pinnedDirectorIds(ctx: ConstitutionContext): Set<string> {
  const ids = new Set<string>();
  for (const agent of ctx.agents) if (agent.agent === "director") for (const slot of agent.slots.values()) if (!pinBlocker(slot)) ids.add(slot.id);
  return ids;
}

function traceRows(ctx: ConstitutionContext, check: "R20.1" | "R20.2", accept: (slot: SlotRecord) => boolean): Row[] {
  const pinned = pinnedDirectorIds(ctx);
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) {
    if (!accept(slot) || !owesDirectorTrace(slot.agent, slot.id) || pinBlocker(slot)) continue;
    const name = (slot.pin!.value as Record<string, unknown>).candidate as string;
    const candidate = slot.candidates.find(each => each.name === name)!;
    const problem = directorTraceProblem(name, candidateReason(name, candidate.text), pinned);
    if (problem) rows.push(row("R20", check, slot, `pinned ${name}: ${problem}`, candidate.path, name));
  }
  return rows;
}

export const designerTrace = (ctx: ConstitutionContext): Row[] => traceRows(ctx, "R20.1", slot => slot.agent === "designer");
export const writerTrace = (ctx: ConstitutionContext): Row[] => traceRows(ctx, "R20.2", slot => slot.agent === "writer");

export const R20: RuleModule = { rule: "R20", checks: { "R20.1": designerTrace, "R20.2": writerTrace } };
