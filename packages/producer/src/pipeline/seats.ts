import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDecide } from "./define.js";
import type { Step } from "./define.js";
import { loadSchema, validateValue } from "./schema.js";
import type { SchemaIssue } from "./schema.js";

/** Who decides a decide step: a decision file, never code. A missing file or part is open, never passing. */
export interface Seat {
  readonly by: string;
  readonly llm: { readonly model: string; readonly tier: "low" | "mid" | "high"; readonly promptFile: string } | null;
  readonly human: { readonly procedure: string; readonly command: string } | null;
}

export type SeatState = "assigned" | "partial" | "unassigned" | "invalid";
export interface SeatReport {
  readonly path: string;
  readonly state: SeatState;
  readonly by: string | null;
  readonly llm: Seat["llm"] | "open";
  readonly human: Seat["human"] | "open";
  readonly issues: readonly SchemaIssue[];
}

export function readSeat(root: string, step: Step): SeatReport | null {
  if (!isDecide(step) || !step.seat) return null;
  const file = join(root, step.seat);
  if (!existsSync(file)) return { path: step.seat, state: "unassigned", by: null, llm: "open", human: "open", issues: [] };
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch { return { path: step.seat, state: "invalid", by: null, llm: "open", human: "open", issues: [{ path: "/", message: "not JSON" }] }; }
  const issues = validateValue(value, loadSchema("seat"));
  if (issues.length) return { path: step.seat, state: "invalid", by: null, llm: "open", human: "open", issues };
  const seat = value as Seat;
  const llm = seat.llm ?? "open", human = seat.human ?? "open";
  const state: SeatState = llm !== "open" && human !== "open" ? "assigned" : llm === "open" && human === "open" ? "unassigned" : "partial";
  return { path: step.seat, state, by: seat.by, llm, human, issues: [] };
}

export function readSeats(root: string, steps: readonly Step[]): Record<string, SeatReport> {
  const seats: Record<string, SeatReport> = {};
  for (const step of steps) { const seat = readSeat(root, step); if (seat) seats[step.id] = seat; }
  return seats;
}
