/**
 * The seat policy: which model id each seat tier uses, a consumer config file
 * (`clossys/seat-policy.json`, schema seat-policy), recorded only by `clossys seat --policy`.
 * Seat answers fill their `<model:low|mid|high>` placeholders from it and never guess a model id;
 * while it is missing, the seat-policy question is the first one the Producer interview asks.
 * A human-only policy records that no seat has an llm, so its seat answers offer no model.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSchema, validateValue } from "./schema.js";
import type { SchemaIssue } from "./schema.js";

export const SEAT_POLICY_FILE = "clossys/seat-policy.json";
export const SEAT_POLICY_SCHEMA = "clossys.seat-policy/1";
export const SEAT_TIERS = ["low", "mid", "high"] as const;
export type SeatTier = typeof SEAT_TIERS[number];

export interface SeatPolicy {
  readonly schema: typeof SEAT_POLICY_SCHEMA;
  readonly models: Readonly<Partial<Record<SeatTier, string>>>;
  readonly humanOnly: boolean;
}
export type SeatPolicyState =
  | { readonly state: "missing"; readonly path: string }
  | { readonly state: "invalid"; readonly path: string; readonly issues: readonly SchemaIssue[] }
  | { readonly state: "ok"; readonly path: string; readonly policy: SeatPolicy };

/** The workspace's seat policy, read from real bytes; a missing or invalid file is never a default. */
export function readSeatPolicy(root: string): SeatPolicyState {
  let text: string;
  try { text = readFileSync(join(root, SEAT_POLICY_FILE), "utf8"); }
  catch { return { state: "missing", path: SEAT_POLICY_FILE }; }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { state: "invalid", path: SEAT_POLICY_FILE, issues: [{ path: "/", message: "not JSON" }] }; }
  const issues = validateSeatPolicy(value);
  return issues.length ? { state: "invalid", path: SEAT_POLICY_FILE, issues } : { state: "ok", path: SEAT_POLICY_FILE, policy: value as SeatPolicy };
}

/** Schema issues, plus the two rules a schema cannot say: a policy names a model or is human-only, never both or neither. */
export function validateSeatPolicy(value: unknown): SchemaIssue[] {
  const issues = validateValue(value, loadSchema("seat-policy"));
  if (issues.length) return issues;
  const policy = value as SeatPolicy;
  const named = Object.keys(policy.models).length;
  if (policy.humanOnly && named) return [{ path: "/models", message: "a human-only policy names no model" }];
  if (!policy.humanOnly && !named) return [{ path: "/models", message: "name at least one tier's model, or record a human-only policy" }];
  return [];
}

/** The tier models a seat answer may fill: the policy's, and none while it is missing, invalid or human-only. */
export function policyModels(state: SeatPolicyState): Readonly<Partial<Record<SeatTier, string>>> {
  return state.state === "ok" && !state.policy.humanOnly ? state.policy.models : {};
}
