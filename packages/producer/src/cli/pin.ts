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
import { candidatePath, parseCandidateName } from "../records/candidate.js";
import { sha256Hex } from "../records/hash.js";
import { oldSlotRefusal } from "../records/store-format.js";
import { buildPin, cliActor, ownerAnswerRef, pinIssues, pinPath, toIsoZ, writePinDoc } from "../records/pin.js";
import { pinMapIssues, readPinFile, setPinMapRecord, writeTargetPin } from "../records/pin-map.js";
import { publicationOf } from "../release/paths.js";
import { isReleaseSlot } from "../release/pins.js";
import { readyFindings } from "../release/ready.js";
import type { AgentId, PinRecord } from "../records/types.js";
import { CONFIRMED_BY, OWNER_WORDS_REF, OWNER_WORDS_REF_FORM, PIN_BASES, SLOT_AGENTS, type PinBasis, type PinConfirmation, type SlotAgent } from "../records/slot-model/index.js";
import { listSlots, readSlotEntry } from "../records/slots.js";
import { GuardRefusal, SLOT_LOCK, withDirLock, writeConfirm, writeNotNeeded, writePin, writeTargetConfirm, writeTargetDecision, type WriteGuard } from "../records/slot-write.js";
import "../constitution/guard.js"; // registers the write guard's runner
import { pinGate, writeScorecard } from "../constitution/pin-gate.js";
import { clearReverdict } from "../constitution/cascade.js";
import { seatRefusal } from "../records/seat-owner.js";
import { ownerDecisionRefusal } from "../records/owner-answer.js";
import { certifiedStandardRef, currentStandardOf, isAgentLoop, isLoopAgent } from "../loop/agent-loops.js";
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
  if (isTargetSlot(workspace, agent, id.split("#")[0]!)) return runTargetPin(workspace, agent, id, candidateId, flags, guard);
  // One format (foundry-build-0048 U13): this verb writes clossys.slot/2 and clossys.pin/2 only. A clossys.slot/1 slot
  // (or a placed slot with no slot.json) is refused: clossys migrate slots converts the store first.
  const slotId = id.split("#")[0]!;
  // The actor is judged before the format (Q9): a non-owner --confirm, or a seat on another agent's slot, is refused by name.
  if (flags.confirm && !CONFIRMED_BY.test(flags.by)) throw new CliUsageError(`--confirm is the owner's: --by must be owner[:<ref>], got ${flags.by}\n${PIN_USAGE}`);
  if (flags.by.startsWith("agent:")) {
    const crossing = seatRefusal(flags.by, agent);
    if (crossing !== undefined) return { exitCode: 1, message: `pin refused: ${crossing}` };
  }
  if (!existsSync(join(workspace, "clossys", "agents", agent, slotId))) return { exitCode: 1, message: `pin refused: unknown slot ${agent}/${slotId} (no slot folder)` };
  if (isReleaseSlot(agent, slotId)) return { exitCode: 1, message: `pin refused: ${agent}/${id} is a release slot whose slot.json is not a readable clossys.slot/2 slot: a ready-pin needs release.ready${isOldTargetSlot(workspace, agent, slotId) ? "; run clossys migrate slots --apply first" : ""}` };
  return { exitCode: 1, message: oldSlotRefusal("pin", `${agent}/${slotId}`) };
}

export { oldSlotRefusal };

/** True when `<root>/clossys/agents/<agent>/<slot-id>/slot.json` is an old `clossys.slot/1` slot. */
export function isOldTargetSlot(root: string, agent: string, slotId: string): boolean {
  const file = join(root, "clossys", "agents", agent, slotId, "slot.json");
  if (!existsSync(file)) return false;
  try { return (JSON.parse(readFileSync(file, "utf8")) as { schema?: unknown }).schema === "clossys.slot/1"; } catch { return false; }
}

/**
 * The gated slot/2 pin as another verb takes it (pick, approve): the same deciders, queue-answer binding, CHOOSE
 * gate, scorecard and slot lock as `clossys pin`, writing clossys.pin/2 (or one pin-map record) only.
 */
export function pinTargetSlot(root: string, agent: string, target: string, candidate: string, input: { readonly by: string; readonly basis?: string; readonly at?: string }): CliResult {
  return runTargetPin(root, agent, target, candidate, { positional: [], by: input.by, ...(input.basis !== undefined ? { basis: input.basis } : {}), ...(input.at !== undefined ? { at: input.at } : {}), notNeeded: false, confirm: false, help: false });
}

/** True when `<root>/clossys/agents/<agent>/<slot-id>/slot.json` is a target `clossys.slot/2` slot. */
export function isTargetSlot(root: string, agent: string, slotId: string): boolean {
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
function runTargetPin(root: string, agent: string, target: string, candidateId: string | undefined, flags: Flags, guard: WriteGuard = true): CliResult {
  const hash = target.indexOf("#");
  const slotId = hash < 0 ? target : target.slice(0, hash);
  const record = hash < 0 ? undefined : target.slice(hash + 1);
  if (hash >= 0 && !record) throw new CliUsageError(`pin target #<record> is empty\n${PIN_USAGE}`);
  if (flags.confirm) return runTargetConfirm(root, agent, slotId, record, candidateId, flags, guard);
  if (flags.notNeeded) return runTargetNotNeeded(root, agent, slotId, record, candidateId, flags);
  if (flags.reason !== undefined || flags.ref !== undefined) {
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
  } else if (by.startsWith("agent:")) {
    // The shared seat rule (records/seat-owner.ts), before the gate writes a scorecard: a registered seat, on its own slots.
    const crossing = seatRefusal(by, agent);
    if (crossing !== undefined) return { exitCode: 1, message: `pin refused: ${crossing}` };
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
  // An owner pin (pick, approve, bulk) records only a typed, owner-answered entry bound to this slot and candidate
  // (records/owner-answer.ts, U13 r4 B2): `{}`, an untyped object or an unanswered entry decides no pin.
  if (answer) {
    const bound = ownerDecisionRefusal(root, by, { kind: "pin", slot: `${agent}/${slotId}`, target: `${agent}/${target}`, candidate });
    if (bound !== undefined) return { exitCode: 1, message: `pin refused: ${bound}` };
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
      // U9a fix round 4 (blind1 B2): an agent's own loop is certified against the Producer loop the consumer runs now
      // (its owner pin, else package v1); the pin names that loop, so an owner repin of it refuses this pin until recertified.
      const loopStandard = isLoopAgent(agent) && isAgentLoop(slotId) && record === undefined ? currentStandardOf(root, slotId) : undefined;
      if (loopStandard !== undefined && !loopStandard.ok) return { exitCode: 1, message: `pin refused: ${agent}/${slotId}: producer/${slotId} cannot be read: ${loopStandard.reason}` };
      const gate = pinGate(root, join(root, "clossys"), agent, slotId, candidate, toIsoZ(at)!, releasePin ? { verdict: "release.ready" } : {});
      if (gate.refusals.length) return { exitCode: 1, message: `pin refused: ${agent}/${target} ${candidate}:\n${gate.refusals.map(line => `  ${line}`).join("\n")}`, output: { schema: "clossys.pin-refused/1", slot: `${agent}/${slotId}`, refusals: gate.refusals, scorecard: gate.scorecard } };
      const scorecard = writeScorecard(root, agent, slotId, gate.scorecard);
      let doc!: ReturnType<typeof writeTargetPin>;
      // The decision lands on the slot ledger with the pin (U13 r3): a `pick` or `pin` event naming the record, as R02.3 reads it.
      writeTargetDecision(join(root, "clossys"), agent as SlotAgent, slotId, record !== undefined ? { record } : {}, () => {
        doc = writeTargetPin(root, {
          agent: agent as AgentId, slotId, ...(record !== undefined ? { record } : {}),
          candidate, decidedBy: by, basis, at: toIsoZ(at)!, refs: [...(answer ? [answer] : []), scorecard, ...(loopStandard?.ok ? [certifiedStandardRef(loopStandard.file)] : [])], createdBy: cliActor("clossys pin"),
        });
        return doc.kind === "pin-map" ? doc.records[record!]! : doc;
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

/**
 * A clossys.slot/2 slot set aside (U13 r2): `contract.notNeeded {reason, since, decidedBy}` and status parked, the pin
 * removed (writeNotNeeded). An owner decision names the queue entry the owner answered (`--by owner:queue.<kind>#<id>`,
 * which must exist); the planner may set a slot aside on its own (`--by planner[:<ref>]`). A bare owner is refused.
 */
function runTargetNotNeeded(root: string, agent: string, slotId: string, record: string | undefined, candidateId: string | undefined, flags: Flags): CliResult {
  if (record !== undefined || candidateId !== undefined) throw new CliUsageError(`--not-needed sets the whole slot aside; it takes no <candidate> or #<record>\n${PIN_USAGE}`);
  if (flags.basis !== undefined || flags.ref !== undefined) throw new CliUsageError(`--not-needed takes --reason, --by and --at only\n${PIN_USAGE}`);
  if (!flags.reason?.trim()) throw new CliUsageError(`--not-needed requires --reason <text>\n${PIN_USAGE}`);
  const at = flags.at ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) throw new CliUsageError(`--at must be an ISO timestamp\n${PIN_USAGE}`);
  const answer = ownerAnswerRef(flags.by);
  // DRAFT copy (not owner-approved).
  if (!answer && !/^planner(:|$)/.test(flags.by)) return { exitCode: 1, message: `pin refused: --by ${flags.by} names no queue answer; an owner sets a clossys.slot/2 slot aside with --by owner:queue.<kind>#<id>, else planner[:<ref>]` };
  if (answer) {
    const bound = ownerDecisionRefusal(root, flags.by, { kind: "not-needed", slot: `${agent}/${slotId}` });
    if (bound !== undefined) return { exitCode: 1, message: `pin refused: ${bound}` };
  }
  try {
    const doc = writeNotNeeded(join(root, "clossys"), agent as SlotAgent, slotId, { reason: flags.reason.trim(), since: at.slice(0, 10), decidedBy: flags.by }, { at: toIsoZ(at)! });
    return { exitCode: 0, message: `${agent}/${slotId}: not needed (${doc.notNeeded!.reason}), decided by ${doc.notNeeded!.decidedBy}`, decision: { slot: `${agent}/${slotId}`, state: "not-needed", ...doc.notNeeded } };
  } catch (error) {
    return { exitCode: 1, message: `pin refused: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * The owner's confirmation of an agent pick on a clossys.slot/2 slot (U13): an owner decision, so it names the queue
 * entry the owner answered (`--by owner:queue.<kind>#<id>`, the entry must exist, and a clossys.queue-entry/2 entry
 * must be answered `pin <slot> <candidate> --confirm`), as pin, approve and seat do. The pin/2 (or pin-map record)
 * must be the agent pick of exactly this candidate, still matching its bytes; the confirmation (its ref the queue
 * entry, or `--ref` when given) and the answers ref are added under the slot lock, the `confirm` event lands on the
 * slot ledger and the pin guard runs (writeTargetConfirm). Never a pin/1.
 */
function runTargetConfirm(root: string, agent: string, slotId: string, record: string | undefined, candidateId: string | undefined, flags: Flags, guard: WriteGuard): CliResult {
  if (flags.notNeeded) throw new CliUsageError(`--confirm confirms an agent pick; it takes no --not-needed\n${PIN_USAGE}`);
  if (flags.basis !== undefined) throw new CliUsageError(`--confirm keeps the agent pick's basis agent; it takes no --basis\n${PIN_USAGE}`);
  if (!CONFIRMED_BY.test(flags.by)) throw new CliUsageError(`--confirm is the owner's: --by must be owner:queue.<kind>#<id>, got ${flags.by}\n${PIN_USAGE}`);
  const answer = ownerAnswerRef(flags.by);
  // DRAFT copy (not owner-approved).
  if (!answer) return { exitCode: 1, message: `confirm refused: --by ${flags.by} names no queue answer; on a clossys.slot/2 slot the owner confirms an agent pick with --by owner:queue.<kind>#<id> (the queue entry holding the owner's answer: clossys request <id> --answer <option>)` };
  const cited = flags.ref?.trim();
  const ref = cited || `${answer.to}#${answer.record}`;
  if (cited && !OWNER_WORDS_REF.test(cited)) throw new CliUsageError(`--confirm --ref must cite the ledger comment that holds the owner's words (${OWNER_WORDS_REF_FORM}), got ${ref}\n${PIN_USAGE}`);
  if (candidateId === undefined) throw new CliUsageError(`pin --confirm requires <candidate>\n${PIN_USAGE}`);
  const at = flags.at ?? new Date().toISOString();
  const atZ = /^\d{4}-\d{2}-\d{2}T/.test(at) ? toIsoZ(at) : undefined;
  if (!atZ) throw new CliUsageError(`--at must be an ISO timestamp\n${PIN_USAGE}`);
  const target = `${agent}/${slotId}${record !== undefined ? `#${record}` : ""}`;
  const lock = join(root, "clossys", "agents", agent, slotId, SLOT_LOCK);
  try {
    return withDirLock(lock, "Slot is unavailable or another decision write is in progress", (): CliResult => {
      const file = pinPath(root, agent as AgentId, slotId);
      const read = readPinFile(file, { agent: agent as AgentId, slotId });
      if (read.kind !== "pin" && read.kind !== "pin-map") return { exitCode: 1, message: `confirm refused: ${target} has no clossys.pin/2 agent pick to confirm${read.kind === "none" ? "" : ` (${read.issues.join("; ")})`}` };
      const held = read.kind === "pin-map" ? (record !== undefined ? read.doc.records[record] : undefined) : record === undefined ? read.doc : undefined;
      if (!held) return { exitCode: 1, message: `confirm refused: ${target} names no pinned record` };
      if (held.basis !== "agent") return { exitCode: 1, message: `confirm refused: ${target} is pinned with basis ${held.basis}; only an agent pick is confirmed` };
      if (held.candidate !== candidateId && held.candidate.replace(/\.(?:md|json|svg)$/, "") !== candidateId) return { exitCode: 1, message: `confirm refused: ${target} holds the agent pick ${held.candidate}, not ${candidateId}` };
      if (held.confirmed) return { exitCode: 1, message: `confirm refused: ${target} ${held.candidate} is already confirmed (${held.confirmed.ref})` };
      // Only the owner's typed clossys.queue-entry/2 answer `pin <target> <candidate> --confirm` confirms (records/owner-answer.ts).
      const bound = ownerDecisionRefusal(root, flags.by, { kind: "confirm", slot: `${agent}/${slotId}`, target, candidate: held.candidate });
      if (bound !== undefined) return { exitCode: 1, message: `confirm refused: ${bound}` };
      const bytes = readFileSync(candidatePath(root, agent as AgentId, slotId, held.candidate));
      if (sha256Hex(bytes) !== held.sha256) return { exitCode: 1, message: `confirm refused: ${target} ${held.candidate} bytes no longer match the pick's sha256` };
      if (Date.parse(atZ) < Date.parse(held.at)) return { exitCode: 1, message: `confirm refused: --at ${atZ} is before the pick (${held.at})` };
      const pinRecord: PinRecord = { candidate: held.candidate, sha256: held.sha256, decidedBy: held.decidedBy, basis: held.basis, at: held.at, confirmed: { by: "owner", ref, at: atZ } };
      let doc;
      if (read.kind === "pin-map") {
        doc = setPinMapRecord(read.doc, { agent: agent as AgentId, slotId, record: record!, pin: pinRecord, refs: [answer], createdBy: cliActor("clossys pin"), at: atZ })!;
        const issues = pinMapIssues(doc, { agent: agent as AgentId, slotId });
        if (issues.length) return { exitCode: 1, message: `confirm refused: ${issues.join("; ")}` };
      } else {
        const refs = read.doc.refs.some(each => each.rel === answer.rel && each.to === answer.to && each.record === answer.record) ? read.doc.refs : [...read.doc.refs, answer];
        doc = buildPin({ agent: agent as AgentId, slotId, record: pinRecord, refs, createdBy: cliActor("clossys pin"), previous: read.doc });
        const issues = pinIssues(doc, { agent: agent as AgentId, slotId });
        if (issues.length) return { exitCode: 1, message: `confirm refused: ${issues.join("; ")}` };
      }
      const written = doc;
      writeTargetConfirm(join(root, "clossys"), agent as SlotAgent, slotId, { candidate: held.candidate, sha256: held.sha256, confirmed: pinRecord.confirmed!, by: flags.by, at: atZ, ...(record !== undefined ? { record } : {}) }, () => writePinDoc(file, written), guard);
      return { exitCode: 0, message: `${target}: ${held.candidate} picked by ${held.decidedBy} (${held.basis}), confirmed by owner (${ref})`, output: doc, decision: { slot: target, state: "pinned", ...pinRecord } };
    });
  } catch (error) {
    return { exitCode: 1, message: `confirm refused: ${error instanceof Error ? error.message : String(error)}` };
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
