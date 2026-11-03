/**
 * `clossys pin` and `clossys decisions`: the one writer and the one reader of slot decisions
 * (rule R-DECISIONS-BY-CLI). Decision files are never hand-edited.
 *
 *   clossys pin <agent>/<slot> <candidate-id> [--by <who>] [--at <iso>] [--root <dir>] [--json]
 *   clossys pin <agent>/<slot> --not-needed --reason <text> [--by <who>] [--at <iso>] [--root <dir>] [--json]
 *   clossys decisions [--root <dir>] [--json]
 */
import { join, resolve } from "node:path";
import { SLOT_AGENTS, type SlotAgent } from "../records/slot-model/index.js";
import { listSlots, readSlotEntry } from "../records/slots.js";
import { writeNotNeeded, writePin } from "../records/slot-write.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverWorkspace } from "./migrate.js";

export const PIN_USAGE = "Usage: clossys pin <agent>/<slot> <candidate-id> [--by <who>] [--at <iso timestamp>] [--root <dir>] [--json]\n"
  + "       clossys pin <agent>/<slot> --not-needed --reason <text> [--by <who>] [--at <iso>] [--root <dir>] [--json]\n"
  + "  <candidate-id> is a file in the slot's candidates/ (`hero-v2.json`) or that name without its extension (`hero-v2`).\n"
  + "  --by: owner[:<message ref>] (default owner), planner[:<message ref>], or migrated.";
export const DECISIONS_USAGE = "Usage: clossys decisions [--root <dir>] [--json]\n"
  + "  every slot as pinned | not-needed | open, with counts";

export type DecisionState = "pinned" | "not-needed" | "open";
export interface DecisionRow {
  readonly slot: string;
  readonly state: DecisionState;
  readonly candidate?: string;
  readonly reason?: string;
  readonly decidedBy?: string;
  /** Why an `open` slot is open: the loader's rejection (`no-pin`, `invalid-pin`, ...). */
  readonly rejection?: string;
}

interface Flags { positional: string[]; by: string; at?: string; root?: string; notNeeded: boolean; reason?: string; help: boolean }

function parse(argv: readonly string[], usage: string): Flags {
  const flags: Flags = { positional: [], by: "owner", notNeeded: false, help: false };
  const value = (index: number, name: string): string => {
    const next = argv[index];
    if (next === undefined || next.startsWith("--")) throw new CliUsageError(`${name} requires a value\n${usage}`);
    return next;
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--json") continue;
    else if (arg === "--help") flags.help = true;
    else if (arg === "--not-needed") flags.notNeeded = true;
    else if (arg === "--by") flags.by = value(++index, "--by");
    else if (arg === "--at") flags.at = value(++index, "--at");
    else if (arg === "--root") flags.root = value(++index, "--root");
    else if (arg === "--reason") flags.reason = value(++index, "--reason");
    else if (arg.startsWith("--")) throw new CliUsageError(`Unknown argument: ${arg}\n${usage}`);
    else flags.positional.push(arg);
  }
  return flags;
}

function consumerOf(cwd: string, root: string | undefined): string {
  return join(discoverWorkspace(resolve(cwd, root ?? ".")), "clossys");
}

/** Resolve a candidate id to its file name, or undefined when the slot has no such candidate. */
export function resolveCandidate(candidates: readonly string[], id: string): string | undefined {
  if (candidates.includes(id)) return id;
  const matches = candidates.filter(name => name.replace(/\.(?:md|json)$/, "") === id);
  return matches.length === 1 ? matches[0] : undefined;
}

export async function runPinCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parse(argv, PIN_USAGE);
  if (flags.help) return { exitCode: 0, message: PIN_USAGE };
  const [target, candidateId, ...extra] = flags.positional;
  if (!target) throw new CliUsageError(`pin requires <agent>/<slot>\n${PIN_USAGE}`);
  if (extra.length) throw new CliUsageError(`Unexpected argument: ${extra[0]}\n${PIN_USAGE}`);
  const slash = target.indexOf("/");
  const agent = target.slice(0, slash), id = target.slice(slash + 1);
  if (slash < 1 || !id) throw new CliUsageError(`pin target must be <agent>/<slot>, got ${target}\n${PIN_USAGE}`);
  if (!(SLOT_AGENTS as readonly string[]).includes(agent)) return { exitCode: 1, message: `pin refused: unknown agent ${agent} (expected ${SLOT_AGENTS.join(", ")})` };
  if (flags.notNeeded === (candidateId !== undefined)) {
    throw new CliUsageError(`pin takes either <candidate-id> or --not-needed --reason <text>\n${PIN_USAGE}`);
  }
  if (!flags.notNeeded && flags.reason !== undefined) throw new CliUsageError(`--reason is only for --not-needed\n${PIN_USAGE}`);
  const consumer = consumerOf(cwd, flags.root);
  const entry = readSlotEntry(consumer, agent as SlotAgent, id);
  if (!entry) return { exitCode: 1, message: `pin refused: unknown slot ${agent}/${id} (not in ${agent} ia.json)` };
  const at = flags.at ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) throw new CliUsageError(`--at must be an ISO timestamp\n${PIN_USAGE}`);
  try {
    if (flags.notNeeded) {
      if (!flags.reason?.trim()) throw new CliUsageError(`--not-needed requires --reason <text>\n${PIN_USAGE}`);
      const doc = writeNotNeeded(consumer, agent as SlotAgent, id, { reason: flags.reason, since: at.slice(0, 10), decidedBy: flags.by });
      return { exitCode: 0, message: `${agent}/${id}: not needed (${doc.notNeeded!.reason}), decided by ${doc.notNeeded!.decidedBy}`, decision: { slot: `${agent}/${id}`, state: "not-needed", ...doc.notNeeded } };
    }
    const candidate = resolveCandidate(entry.candidates, candidateId!);
    if (!candidate) return { exitCode: 1, message: `pin refused: ${agent}/${id} has no candidate ${candidateId}${entry.candidates.length ? ` (candidates: ${entry.candidates.join(", ")})` : " (no candidates)"}` };
    const pin = writePin(consumer, agent as SlotAgent, id, candidate, { decidedBy: flags.by, at });
    return { exitCode: 0, message: `${agent}/${id}: pinned ${pin.candidate} (${pin.sha256.slice(0, 12)}), decided by ${pin.decidedBy}`, decision: { slot: `${agent}/${id}`, state: "pinned", ...pin } };
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, message: message.startsWith("pin refused") || message.startsWith("not-needed refused") ? message : `pin refused: ${message}` };
  }
}

/** Every IA slot across agents, in agent then IA order, as the one loader decides its state. */
export function listDecisions(consumer: string): DecisionRow[] {
  const rows: DecisionRow[] = [];
  for (const agent of SLOT_AGENTS) for (const entry of listSlots(consumer, agent)) {
    const slot = `${agent}/${entry.id}`, state = entry.state;
    if (state.state === "pinned") rows.push({ slot, state: "pinned", candidate: state.pin.candidate, decidedBy: state.pin.decidedBy });
    else if (state.state === "not-needed") rows.push({ slot, state: "not-needed", reason: state.notNeeded.reason, decidedBy: state.notNeeded.decidedBy });
    else rows.push({ slot, state: "open", rejection: state.reason });
  }
  return rows;
}

export async function runDecisionsCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parse(argv, DECISIONS_USAGE);
  if (flags.help) return { exitCode: 0, message: DECISIONS_USAGE };
  if (flags.positional.length || flags.notNeeded || flags.reason !== undefined || flags.at !== undefined || argv.includes("--by")) {
    throw new CliUsageError(`decisions takes only --root and --json\n${DECISIONS_USAGE}`);
  }
  const consumer = consumerOf(cwd, flags.root);
  const rows = listDecisions(consumer);
  const counts = { pinned: 0, "not-needed": 0, open: 0 };
  for (const row of rows) counts[row.state]++;
  const lines = rows.map(row => `${row.state.padEnd(10)} ${row.slot}${row.candidate ? ` ${row.candidate}` : ""}${row.reason ? ` (${row.reason})` : ""}${row.rejection && row.rejection !== "no-pin" ? ` [${row.rejection}]` : ""}`);
  lines.push(`decisions: ${rows.length} slots, ${counts.pinned} pinned, ${counts["not-needed"]} not-needed, ${counts.open} open`);
  return { exitCode: 0, message: lines.join("\n"), decisions: { counts, slots: rows } };
}
