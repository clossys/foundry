import { join } from "node:path";
import { readSeatText } from "../records/slots.js";
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

/** The seat folders sit in the Producer tree of the workspace's consumer folder (define.ts seatPath). */
const CONSUMER = "clossys";

export function readSeat(root: string, step: Step): SeatReport | null {
  if (!isDecide(step) || !step.seat) return null;
  let text: string | undefined;
  try { text = readSeatText(join(root, CONSUMER), step.id); }
  catch (error) { return { path: step.seat, state: "invalid", by: null, llm: "open", human: "open", issues: [{ path: "/", message: (error as Error).message }] }; }
  if (text === undefined) return { path: step.seat, state: "unassigned", by: null, llm: "open", human: "open", issues: [] };
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { return { path: step.seat, state: "invalid", by: null, llm: "open", human: "open", issues: [{ path: "/", message: "not JSON" }] }; }
  const issues = validateValue(value, loadSchema("seat"));
  if (issues.length) return { path: step.seat, state: "invalid", by: null, llm: "open", human: "open", issues };
  const seat = value as Seat;
  const llm = seat.llm ?? "open", human = seat.human ?? "open";
  const state: SeatState = llm !== "open" && human !== "open" ? "assigned" : llm === "open" && human === "open" ? "unassigned" : "partial";
  return { path: step.seat, state, by: seat.by, llm, human, issues: [] };
}

/**
 * W4 (planner decision 2026-11-04): a pick seat uses the llm assignment of its agent's make step,
 * so the agent that made a slot's options is the llm that picks among them: `pick.<agent>` takes
 * the llm of `<agent>.candidates`. check:pipeline fails a pick seat whose llm differs. A separate
 * judge llm is not modeled; until one is, the judge stays the pick seat's (null) llm, listed OPEN.
 */
export function llmSourceOf(stepId: string): string | null {
  const match = /^pick\.([a-z][a-z0-9-]*)$/.exec(stepId);
  return match ? `${match[1]}.candidates` : null;
}

export function readSeats(root: string, steps: readonly Step[]): Record<string, SeatReport> {
  const seats: Record<string, SeatReport> = {};
  for (const step of steps) { const seat = readSeat(root, step); if (seat) seats[step.id] = seat; }
  return seats;
}
