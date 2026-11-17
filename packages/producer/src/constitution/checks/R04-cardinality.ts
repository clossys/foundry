/**
 * R04 Cardinality: every live slot (all five agents, Producer seats included) has at least one
 * candidate, exactly one pin.json, and that pinned file exists with a matching sha256. slot.json has
 * no `notNeeded` key: the "not needed" state no longer exists (D4). One row per failing slot, with
 * every defect of that slot in its reason.
 */
import type { ConstitutionContext, Row, RuleModule } from "../types.js";
import { isObject, liveSlots, row, slotDoc } from "./shared.js";

export function cardinality(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const agent of ctx.agents) for (const { id, record } of liveSlots(agent)) {
    if (!record) { rows.push(row("R04", "R04", { agent: agent.agent, id }, "live slot has no folder", `${agent.dir}/${id}`)); continue; }
    const defects: string[] = [];
    if (record.candidates.length === 0) defects.push("no candidate");
    const pin = record.pin;
    if (!pin) defects.push("no pin.json");
    else if (pin.error !== undefined) defects.push(`pin.json unreadable (${pin.error})`);
    else if (!isObject(pin.value) || typeof pin.value.candidate !== "string") defects.push("pin.json names no candidate");
    else {
      const pinned = pin.value.candidate;
      const named = record.candidates.find(candidate => candidate.name === pinned);
      if (!named) defects.push(`pinned candidate ${pinned} does not exist`);
      else if (pin.value.sha256 !== named.sha256) defects.push(`pinned candidate ${named.name} sha256 does not match pin.json`);
    }
    const doc = slotDoc(record);
    if (isObject(doc) && Object.hasOwn(doc, "notNeeded")) defects.push("slot.json carries notNeeded (retire or pin, D4)");
    if (defects.length) rows.push(row("R04", "R04", record, defects.join("; "), record.dir));
  }
  return rows;
}

export const R04: RuleModule = { rule: "R04", checks: { "R04": cardinality } };
