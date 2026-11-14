/**
 * R09 One pin schema: every pin.json in every agent tree (Producer seats included) is valid against
 * schemas/pin.schema.json, keys exactly {candidate, sha256, decidedBy, basis, at, confirmed?}, plus the
 * pairing rules a schema cannot state: basis `agent` iff decidedBy `agent:<seat>`, and `confirmed`
 * only on an agent pick. One row per pin, every failure in its reason.
 */
import { validateAgainst } from "../schema.js";
import type { ConstitutionContext, Row, RuleModule } from "../types.js";
import { allSlots, isObject, listed, row } from "./shared.js";

export function pinIssues(value: unknown): string[] {
  const issues = validateAgainst("pin", value).map(error => `${error.at} ${error.message}`);
  if (isObject(value)) {
    const agentBasis = value.basis === "agent";
    const agentDecided = typeof value.decidedBy === "string" && value.decidedBy.startsWith("agent:");
    if (agentBasis !== agentDecided) issues.push("basis agent and decidedBy agent:<seat> go together");
    if (value.confirmed !== undefined && !agentBasis) issues.push("confirmed is only on an agent pick (basis agent)");
    for (const key of ["at"] as const) if (typeof value[key] === "string" && Number.isNaN(Date.parse(value[key]))) issues.push(`${key} is not a real timestamp`);
  }
  return issues;
}

export function pinSchema(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) {
    const pin = slot.pin;
    if (!pin) continue;
    const issues = pin.error !== undefined ? [`unreadable: ${pin.error}`] : pinIssues(pin.value);
    if (issues.length) rows.push(row("R09", "R09", slot, `pin.json does not match pin.schema.json: ${listed(issues, 3)}`, pin.path));
  }
  return rows;
}

export const R09: RuleModule = { rule: "R09", checks: { "R09": pinSchema } };
