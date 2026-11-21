/**
 * R09 One pin schema: every pin.json in every agent tree (Producer seats included) is valid against
 * schemas/pin.schema.json, keys exactly {candidate, sha256, decidedBy, basis, at, confirmed?}, plus the
 * pairing rules a schema cannot state: basis `agent` iff decidedBy `agent:<seat>`, basis `scorecard` iff
 * decidedBy `code:scorecard`, and `confirmed` only on an agent or code pick. One row per pin, every failure in its reason. A store migrated to the target
 * formats holds `clossys.pin/2` and Writer `clossys.pin-map/1` pins instead: each is judged by its own target
 * schema and the shared record rules (records/pin.ts, records/pin-map.ts), never by the int2 key list.
 */
import { CODE_SCORECARD, confirmableBasis, pinMapIssues, pinIssues as targetPinIssues } from "../../records/pin.js";
import { validateAgainst } from "../schema.js";
import type { ConstitutionContext, Row, RuleModule } from "../types.js";
import { allSlots, isObject, listed, row } from "./shared.js";

export function pinIssues(value: unknown): string[] {
  if (isObject(value) && value.schema === "clossys.pin/2") return targetPinIssues(value);
  if (isObject(value) && value.schema === "clossys.pin-map/1") return pinMapIssues(value);
  const issues = validateAgainst("pin", value).map(error => `${error.at} ${error.message}`);
  if (isObject(value)) {
    const agentBasis = value.basis === "agent";
    const agentDecided = typeof value.decidedBy === "string" && value.decidedBy.startsWith("agent:");
    if (agentBasis !== agentDecided) issues.push("basis agent and decidedBy agent:<seat> go together");
    if ((value.basis === "scorecard") !== (value.decidedBy === CODE_SCORECARD)) issues.push("basis scorecard and decidedBy code:scorecard go together");
    if (value.confirmed !== undefined && !confirmableBasis(value.basis)) issues.push("confirmed is only on an agent or code pick (basis agent or scorecard)");
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
