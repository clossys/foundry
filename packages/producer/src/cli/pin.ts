/**
 * `clossys pin` and `clossys decisions`: the one writer and the one reader of slot decisions
 * (rule R-DECISIONS-BY-CLI). Decision files are never hand-edited.
 *
 *   clossys pin <agent>/<slot> <candidate-id> [--by <who>] [--basis picked|bulk|planner] [--at <iso>] [--root <dir>] [--json]
 *   clossys pin <agent>/<slot> --not-needed --reason <text> [--by <who>] [--at <iso>] [--root <dir>] [--json]
 *   clossys pin <agent>/<slot> <candidate-id> --confirm --ref <ledger ref> [--by owner[:<ref>]] [--at <iso>] [--root <dir>] [--json]
 *   clossys decisions [--root <dir>] [--json]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseCandidateName } from "../records/candidate.js";
import { cliActor, ownerAnswerRef, toIsoZ } from "../records/pin.js";
import { writeTargetPin } from "../records/pin-map.js";
import { publicationOf } from "../release/paths.js";
import { isReleaseSlot } from "../release/pins.js";
import { readyFindings } from "../release/ready.js";
import type { AgentId, PinRecord } from "../records/types.js";
import { CONFIRMED_BY, OWNER_WORDS_REF, OWNER_WORDS_REF_FORM, PIN_BASES, SLOT_AGENTS, type PinBasis, type PinConfirmation, type SlotAgent } from "../records/slot-model/index.js";
import { listSlots, readSlotEntry } from "../records/slots.js";
import { GuardRefusal, SLOT_LOCK, withDirLock, writeConfirm, writeNotNeeded, writePin, type WriteGuard } from "../records/slot-write.js";
import "../constitution/guard.js"; // registers the write guard's runner
import { pinGate, writeScorecard } from "../constitution/pin-gate.js";
import { clearReverdict } from "../constitution/cascade.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const PIN_USAGE = "Usage: clossys pin <agent>/<slot> <candidate-id> [--by <who>] [--basis picked|bulk|planner] [--at <iso timestamp>] [--root <dir>] [--json]\n"
  + "       clossys pin <agent>/<slot> --not-needed --reason <text> [--by <who>] [--at <iso>] [--root <dir>] [--json]\n"
  + "       clossys pin <agent>/<slot> <candidate-id> --confirm --ref <ledger ref> [--by owner[:<ref>]] [--at <iso>] [--root <dir>] [--json]\n"
  + "  <candidate-id> is a file in the slot's candidates/ (`hero-v2.json`) or that name without its extension (`hero-v2`).\n"
  + "  --by: owner[:<ref>] (default owner), planner[:<ref>], migration[:<ref>], or migrated.\n"
  + "  --basis: how the pin was decided. --by planner[:<ref>] is always planner; any other --by needs an explicit\n"
  + "           --basis: picked (the owner chose this candidate) or bulk (a blanket owner approval), or planner.\n"
  + "  --confirm: the owner confirms the slot's agent pick of <candidate-id>; the pin keeps basis agent and its\n"
  + "             agent:<seat> decider and records confirmed {by, ref, at}. --ref names where the owner's words are.\n"
  + "  A pin refuses on any finding of a constitution check whose rules.json guard lists pin (pick for an agent:<seat>\n"
  + "  pick) about the pinned candidate, pin.json or slot.json: an uncertified candidate (R05), an unresolved citation\n"
  + "  (R07.1) or a region no frame composes (R07.6) is never pinned.\n"
  + "  A clossys.slot/2 pin also needs the candidate's submit record (its sha256 the bytes now; a file placed by hand\n"
  + "  is refused) and a passing verdict (certify); it writes the ranked .clossys/checks/<agent>/<slot>/scorecard.json\n"
  + "  and cites it in the pin's refs (producer/checks.scorecard).";
export const DECISIONS_USAGE = "Usage: clossys decisions [--root <dir>] [--json]\n"
  + "  every slot as pinned | not-needed | open, with counts";

export type DecisionState = "pinned" | "not-needed" | "open";
export interface DecisionRow {
  readonly slot: string;
  readonly state: DecisionState;
  readonly candidate?: string;
  readonly reason?: string;
  readonly decidedBy?: string;
  /** How a pinned slot was decided (picked | bulk | planner | agent). */
  readonly basis?: PinBasis;
  /** The owner's confirmation of an agent pick, when recorded. */
  readonly confirmed?: PinConfirmation;
  /** Why an `open` slot is open: the loader's rejection (`no-pin`, `invalid-pin`, ...). */
  readonly rejection?: string;
}

interface Flags { positional: string[]; by: string; basis?: string; at?: string; root?: string; notNeeded: boolean; confirm: boolean; ref?: string; reason?: string; help: boolean }

function parse(argv: readonly string[], usage: string): Flags {
  const flags: Flags = { positional: [], by: "owner", notNeeded: false, confirm: false, help: false };
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
    else if (arg === "--confirm") flags.confirm = true;
    else if (arg === "--ref") flags.ref = value(++index, "--ref");
    else if (arg === "--by") flags.by = value(++index, "--by");
    else if (arg === "--basis") flags.basis = value(++index, "--basis");
    else if (arg === "--at") flags.at = value(++index, "--at");
    else if (arg === "--root") flags.root = value(++index, "--root");
    else if (arg === "--reason") flags.reason = value(++index, "--reason");
    else if (arg.startsWith("--")) throw new CliUsageError(`Unknown argument: ${arg}\n${usage}`);
    else flags.positional.push(arg);
  }
  return flags;
}

function consumerOf(cwd: string, root: string | undefined): string {
  return join(discoverRoot(resolve(cwd, root ?? ".")), "clossys");
}

/**
 * The basis a pin records. `--by planner[:<ref>]` is the planner's own pick (`planner`; another
 * --basis is refused). Any other decider must say how: an explicit `--basis picked|bulk|planner`.
 */
export function pinBasis(by: string, basis: string | undefined): PinBasis {
  const planner = /^planner(?::|$)/.test(by);
  // An agent seat's pick (basis agent, decidedBy agent:<seat>) is written only by clossys pick, which refuses to replace an owner pick.
  if (basis === "agent" || by.startsWith("agent:")) throw new CliUsageError(`an agent seat picks with clossys pick <agent>/<slot> <candidate-id> --by agent:<seat>, not clossys pin\n${PIN_USAGE}`);
  if (basis !== undefined && !(PIN_BASES as readonly string[]).includes(basis)) throw new CliUsageError(`--basis must be ${PIN_BASES.join(", ")}, got ${basis}\n${PIN_USAGE}`);
  if (planner) {
    if (basis !== undefined && basis !== "planner") throw new CliUsageError(`--by ${by} is a planner pin: its basis is planner, not ${basis}\n${PIN_USAGE}`);
    return "planner";
  }
  if (basis === undefined) throw new CliUsageError(`--by ${by} needs an explicit --basis picked|bulk (or planner)\n${PIN_USAGE}`);
  return basis as PinBasis;
}

/** Resolve a candidate id to its file name, or undefined when the slot has no such candidate. */
export function resolveCandidate(candidates: readonly string[], id: string): string | undefined {
  if (candidates.includes(id)) return id;
  const matches = candidates.filter(name => name.replace(/\.(?:md|json)$/, "") === id);
  return matches.length === 1 ? matches[0] : undefined;
}

export async function runPinCli(argv: readonly string[], cwd: string, guard: WriteGuard = true): Promise<CliResult> {
  const flags = parse(argv, PIN_USAGE);
  if (flags.help) return { exitCode: 0, message: PIN_USAGE };
  const [target, candidateId, ...extra] = flags.positional;
  if (!target) throw new CliUsageError(`pin requires <agent>/<slot>\n${PIN_USAGE}`);
  if (extra.length) throw new CliUsageError(`Unexpected argument: ${extra[0]}\n${PIN_USAGE}`);
  const slash = target.indexOf("/");
  const agent = target.slice(0, slash), id = target.slice(slash + 1);
  if (slash < 1 || !id) throw new CliUsageError(`pin target must be <agent>/<slot>, got ${target}\n${PIN_USAGE}`);
  if (!(SLOT_AGENTS as readonly string[]).includes(agent)) return { exitCode: 1, message: `pin refused: unknown agent ${agent} (expected ${SLOT_AGENTS.join(", ")})` };
  const workspace = dirname(consumerOf(cwd, flags.root));
  if (isTargetSlot(workspace, agent, id.split("#")[0]!)) return runTargetPin(workspace, agent, id, candidateId, flags);
  // A release pin is a ready-pin (flows.md F8): only a clossys.slot/2 release slot takes one, through release.ready.
  if (isReleaseSlot(agent, id.split("#")[0]!)) return { exitCode: 1, message: `pin refused: ${agent}/${id} is a release slot whose slot.json is not a readable clossys.slot/2 slot: a ready-pin needs release.ready` };
  if (id.includes("#")) throw new CliUsageError(`a #record target is only for a clossys.slot/2 record slot, got ${target}\n${PIN_USAGE}`);
  if (flags.notNeeded === (candidateId !== undefined)) {
    throw new CliUsageError(`pin takes either <candidate-id> or --not-needed --reason <text>\n${PIN_USAGE}`);
  }
  if (!flags.notNeeded && flags.reason !== undefined) throw new CliUsageError(`--reason is only for --not-needed\n${PIN_USAGE}`);
  if (flags.notNeeded && flags.basis !== undefined) throw new CliUsageError(`--basis is only for a pin, not --not-needed\n${PIN_USAGE}`);
  if (!flags.confirm && flags.ref !== undefined) throw new CliUsageError(`--ref is only for --confirm\n${PIN_USAGE}`);
  if (flags.confirm) {
    if (flags.notNeeded) throw new CliUsageError(`--confirm confirms an agent pick; it takes no --not-needed\n${PIN_USAGE}`);
    // A confirmation keeps the agent's basis: never --basis (bulk was the defect, owner Foundry Director round 8).
    if (flags.basis !== undefined) throw new CliUsageError(`--confirm keeps the agent pick's basis agent; it takes no --basis\n${PIN_USAGE}`);
    if (!CONFIRMED_BY.test(flags.by)) throw new CliUsageError(`--confirm is the owner's: --by must be owner[:<ref>], got ${flags.by}\n${PIN_USAGE}`);
    if (!flags.ref?.trim()) throw new CliUsageError(`--confirm requires --ref <ledger ref> (where the owner's words are recorded)\n${PIN_USAGE}`);
    if (!OWNER_WORDS_REF.test(flags.ref.trim())) throw new CliUsageError(`--confirm --ref must cite the ledger comment that holds the owner's words (${OWNER_WORDS_REF_FORM}), got ${flags.ref.trim()}\n${PIN_USAGE}`);
  }
  const basis = flags.notNeeded || flags.confirm ? undefined : pinBasis(flags.by, flags.basis);
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
    if (flags.confirm) {
      const pin = writeConfirm(consumer, agent as SlotAgent, id, candidate, { by: flags.by, ref: flags.ref!.trim(), at });
      return { exitCode: 0, message: `${agent}/${id}: ${pin.candidate} picked by ${pin.decidedBy} (${pin.basis}), confirmed by ${pin.confirmed!.by} (${pin.confirmed!.ref})`, decision: { slot: `${agent}/${id}`, state: "pinned", ...pin } };
    }
    const pin = writePin(consumer, agent as SlotAgent, id, candidate, { decidedBy: flags.by, basis: basis!, at }, undefined, { guard });
    return { exitCode: 0, message: `${agent}/${id}: pinned ${pin.candidate} (${pin.sha256.slice(0, 12)}), decided by ${pin.decidedBy} (${pin.basis})`, decision: { slot: `${agent}/${id}`, state: "pinned", ...pin } };
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    if (error instanceof GuardRefusal) return { exitCode: 1, message: `pin refused: ${error.message}`, output: { schema: "clossys.pin-refused/1", slot: `${agent}/${id}`, verb: error.verb, checks: error.checks, findings: error.findings } };
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, message: /^(?:pin|not-needed|confirm) refused/.test(message) ? message : `pin refused: ${message}` };
  }
}

/** True when `<root>/clossys/agents/<agent>/<slot-id>/slot.json` is a target `clossys.slot/2` slot. */
function isTargetSlot(root: string, agent: string, slotId: string): boolean {
  const file = join(root, "clossys", "agents", agent, slotId, "slot.json");
  if (!existsSync(file)) return false;
  try { return (JSON.parse(readFileSync(file, "utf8")) as { schema?: unknown }).schema === "clossys.slot/2"; } catch { return false; }
}

/**
 * The target pin (system.md 6.3): writes `clossys.pin/2`, or one record of a Writer `clossys.pin-map/1`
 * (`<agent>/<slot-id>#<record>`). Deciders and bases pair as the pin rules require; an owner decision names the
 * queue entry it answers (`--by owner:queue.<kind>#<id>`, basis picked or --basis bulk) and that entry must exist.
 * A bare `--by owner` is refused: the CLI never invents an owner basis.
 */
function runTargetPin(root: string, agent: string, target: string, candidateId: string | undefined, flags: Flags): CliResult {
  const hash = target.indexOf("#");
  const slotId = hash < 0 ? target : target.slice(0, hash);
  const record = hash < 0 ? undefined : target.slice(hash + 1);
  if (hash >= 0 && !record) throw new CliUsageError(`pin target #<record> is empty\n${PIN_USAGE}`);
  if (flags.notNeeded || flags.confirm || flags.reason !== undefined || flags.ref !== undefined) {
    throw new CliUsageError(`a clossys.slot/2 pin takes <candidate> [--by] [--basis] [--at] only\n${PIN_USAGE}`);
  }
  if (candidateId === undefined) throw new CliUsageError(`pin requires <candidate>\n${PIN_USAGE}`);
  const candidate = parseCandidateName(candidateId) ? candidateId : undefined;
  if (!candidate) return { exitCode: 1, message: `pin refused: ${candidateId} is not a candidate file name (<name>-v<n>.md|json|svg)` };
  const by = flags.by;
  let basis: PinRecord["basis"];
  if (/^planner(:|$)/.test(by)) {
    if (flags.basis !== undefined && flags.basis !== "planner") throw new CliUsageError(`--by ${by} is a planner pin: its basis is planner\n${PIN_USAGE}`);
    basis = "planner";
  } else if (/^agent:(director|designer|writer|publisher|producer)$/.test(by)) {
    if (flags.basis !== undefined && flags.basis !== "agent") throw new CliUsageError(`--by ${by} is an agent pin: its basis is agent\n${PIN_USAGE}`);
    basis = "agent";
  } else if (ownerAnswerRef(by)) {
    if (flags.basis !== undefined && flags.basis !== "picked" && flags.basis !== "bulk") throw new CliUsageError(`--by ${by} is an owner pin: --basis picked or bulk\n${PIN_USAGE}`);
    basis = (flags.basis ?? "picked") as PinRecord["basis"];
  } else {
    return { exitCode: 1, message: `pin refused: --by ${by} names no queue answer; an owner pin is --by owner:queue.<kind>#<id>, else planner[:<ref>] or agent:<agent>` };
  }
  const at = flags.at ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) throw new CliUsageError(`--at must be an ISO timestamp\n${PIN_USAGE}`);
  const answer = ownerAnswerRef(by);
  if (answer && !existsSync(join(root, "clossys", "agents", answer.to, "entries", `${answer.record}.json`))) {
    return { exitCode: 1, message: `pin refused: ${answer.to}#${answer.record} is not a queue entry` };
  }
  const releasePin = agent === "publisher" && isReleaseSlot(agent, slotId) && record === undefined;
  if (releasePin) {
    // A release pin marks a version ready (flows.md F8): refused unless release.ready would pass for it. The
    // owner's entry must name this candidate with the sha256 of its bytes now (ready.ts answerIssues).
    const findings = readyFindings(root, publicationOf(root, slotId), { candidate, decidedBy: by, basis, at: toIsoZ(at)! });
    if (findings.length) return { exitCode: 1, message: `pin refused: ${agent}/${slotId} ${candidate} is not ready:\n${findings.map(row => `  ${row.check ?? "release.ready"}  ${row.subject}  ${row.detail}`).join("\n")}`, output: { findings } };
  }
  // CHOOSE gate (foundry-build-0048 U3): a submitted candidate with a passing verdict, or no pin; the ranked scorecard is cited.
  // A release slot's verdict is the release.ready check above (owner answer bound to the manifest's bytes).
  // The gate, the scorecard and the pin are one critical section under the slot's write lock (the lock a candidate
  // submit takes), so no submit or second pin lands between the verdict and the pin it allows (U6).
  const lock = join(root, "clossys", "agents", agent, slotId, SLOT_LOCK);
  try {
    return withDirLock(lock, "Slot is unavailable or another decision write is in progress", (): CliResult => {
      const gate = pinGate(root, join(root, "clossys"), agent, slotId, candidate, toIsoZ(at)!, releasePin ? { verdict: "release.ready" } : {});
      if (gate.refusals.length) return { exitCode: 1, message: `pin refused: ${agent}/${target} ${candidate}:\n${gate.refusals.map(line => `  ${line}`).join("\n")}`, output: { schema: "clossys.pin-refused/1", slot: `${agent}/${slotId}`, refusals: gate.refusals, scorecard: gate.scorecard } };
      const scorecard = writeScorecard(root, agent, slotId, gate.scorecard);
      const doc = writeTargetPin(root, {
        agent: agent as AgentId, slotId, ...(record !== undefined ? { record } : {}),
        candidate, decidedBy: by, basis, at: toIsoZ(at)!, refs: [...(answer ? [answer] : []), scorecard], createdBy: cliActor("clossys pin"),
      });
      // A new pin carries the verdict the gate just gave (its scorecard row); an older re-verdict no longer holds.
      clearReverdict(root, agent, slotId);
      const pinned = doc.kind === "pin-map" ? doc.records[record!]! : doc;
      return { exitCode: 0, message: `${agent}/${target}: pinned ${pinned.candidate} (${pinned.sha256.slice(0, 12)}), decided by ${pinned.decidedBy} (${pinned.basis})`, output: doc };
    });
  } catch (error) {
    return { exitCode: 1, message: `pin refused: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Every IA slot across agents, in agent then IA order, as the one loader decides its state. */
export function listDecisions(consumer: string): DecisionRow[] {
  const rows: DecisionRow[] = [];
  for (const agent of SLOT_AGENTS) for (const entry of listSlots(consumer, agent)) {
    const slot = `${agent}/${entry.id}`, state = entry.state;
    if (state.state === "pinned") rows.push({ slot, state: "pinned", candidate: state.pin.candidate, decidedBy: state.pin.decidedBy, basis: state.pin.basis, ...(state.pin.confirmed ? { confirmed: state.pin.confirmed } : {}) });
    else if (state.state === "not-needed") rows.push({ slot, state: "not-needed", reason: state.notNeeded.reason, decidedBy: state.notNeeded.decidedBy });
    else rows.push({ slot, state: "open", rejection: state.reason });
  }
  return rows;
}

export async function runDecisionsCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parse(argv, DECISIONS_USAGE);
  if (flags.help) return { exitCode: 0, message: DECISIONS_USAGE };
  if (flags.positional.length || flags.notNeeded || flags.reason !== undefined || flags.at !== undefined || flags.basis !== undefined || argv.includes("--by")) {
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
