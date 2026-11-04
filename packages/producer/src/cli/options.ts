/**
 * `clossys options` and `clossys pick` (CANDIDATE-OPTIONS): variety to choose from.
 *
 *   clossys options [--root <dir>] [--json]                     every choice slot: options held vs required
 *   clossys options --classes [--check] [--root <dir>] [--json] write (or check) slot.json options/varyOn from the class mapping
 *   clossys options <agent>/<slot> [--more] [--root <dir>] [--json]
 *       lists the slot's candidates with their variation and pin status; --more prints the
 *       generation brief for 2-3 fresh candidates. The CLI never writes candidates: the
 *       owning agent (Director or Writer skill) writes them from the brief.
 *   clossys pick <agent>/<slot> <candidate-id> --by agent:<seat> [--at <iso>] [--root <dir>] [--json]
 *       a judge seat picks one candidate: pin.json with basis "agent", shown as "confirm"
 *       in Studio until the owner pins with `clossys pin`.
 */
import { join, resolve } from "node:path";
import { OPTION_TABLE, SLOT_AGENTS, type SlotAgent } from "../records/slot-model/index.js";
import { checkSlotOptions, classCounts, classify, optionPinStatus, slotOptions, type SlotOptions } from "../records/slot-options.js";
import { inspectSlot, listSlots, readCandidate, readSlotEntry } from "../records/slots.js";
import { writePin, writeSlotOptions } from "../records/slot-write.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { resolveCandidate } from "./pin.js";
import { discoverRoot } from "./root.js";

export const OPTIONS_USAGE = "Usage: clossys options [<agent>/<slot> [--more]] [--root <dir>] [--json]\n"
  + "       clossys options --classes [--check] [--root <dir>] [--json]\n"
  + "  lists a slot's candidates by variation; --more prints the brief for 2-3 fresh candidates (the owning agent writes them).\n"
  + "  --classes writes slot.json options/varyOn from the committed option-class mapping; --check only reports drift.";
export const PICK_USAGE = "Usage: clossys pick <agent>/<slot> <candidate-id> --by agent:<seat> [--at <iso timestamp>] [--root <dir>] [--json]\n"
  + "  a judge seat picks one candidate (pin basis agent); Studio shows it as confirm until the owner pins.";

interface Flags { positional: string[]; more: boolean; classes: boolean; check: boolean; by?: string; at?: string; root?: string; help: boolean }

function parse(argv: readonly string[], usage: string, allowed: readonly string[]): Flags {
  const flags: Flags = { positional: [], more: false, classes: false, check: false, help: false };
  const value = (index: number, name: string): string => {
    const next = argv[index];
    if (next === undefined || next.startsWith("--")) throw new CliUsageError(`${name} requires a value\n${usage}`);
    return next;
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg.startsWith("--") && arg !== "--json" && arg !== "--help" && arg !== "--root" && !allowed.includes(arg)) throw new CliUsageError(`Unknown argument: ${arg}\n${usage}`);
    if (arg === "--json") continue;
    else if (arg === "--help") flags.help = true;
    else if (arg === "--more") flags.more = true;
    else if (arg === "--classes") flags.classes = true;
    else if (arg === "--check") flags.check = true;
    else if (arg === "--by") flags.by = value(++index, "--by");
    else if (arg === "--at") flags.at = value(++index, "--at");
    else if (arg === "--root") flags.root = value(++index, "--root");
    else flags.positional.push(arg);
  }
  return flags;
}

const consumerOf = (cwd: string, root: string | undefined) => join(discoverRoot(resolve(cwd, root ?? ".")), "clossys");

function target(raw: string | undefined, usage: string): { agent: SlotAgent; id: string } {
  if (!raw) throw new CliUsageError(`requires <agent>/<slot>\n${usage}`);
  const slash = raw.indexOf("/");
  const agent = raw.slice(0, slash), id = raw.slice(slash + 1);
  if (slash < 1 || !id) throw new CliUsageError(`target must be <agent>/<slot>, got ${raw}\n${usage}`);
  if (!(SLOT_AGENTS as readonly string[]).includes(agent)) throw new CliUsageError(`unknown agent ${agent} (expected ${SLOT_AGENTS.join(", ")})\n${usage}`);
  return { agent: agent as SlotAgent, id };
}

/** Next candidate base name for a variation value: the pinned (or first) candidate's name stem plus the value. */
function nextName(view: SlotOptions, value: string): string {
  const base = (view.candidates.find(c => c.pinned) ?? view.candidates[0])?.name.replace(/-v\d+\.(?:md|json)$/, "") ?? view.slot.replace(/\./g, "-");
  return `${base}-${value}`;
}

/** The generation brief `--more` prints: what the owning agent writes next. Deterministic; no model call. */
export function optionsBrief(consumer: string, view: SlotOptions): Record<string, unknown> {
  const doc = inspectSlot(consumer, view.agent, view.slot).doc;
  const fill = view.missing.length ? view.missing : view.values;
  const count = Math.min(3, Math.max(2, view.options - view.distinct, view.missing.length));
  const values = fill.slice(0, count);
  const reference = view.candidates.find(c => c.pinned) ?? view.candidates[0];
  const referenceBytes = reference ? readCandidate(consumer, view.agent, view.slot, reference.name).bytes : "";
  const recordIds = [...referenceBytes.matchAll(/^<!-- (\{.*\}) -->$/gm)].map(match => { try { return (JSON.parse(match[1]!) as { id?: string }).id; } catch { return undefined; } }).filter(Boolean);
  return {
    slot: `${view.agent}/${view.slot}`, group: view.group, class: view.classId, varyOn: view.varyOn,
    write: values.map(value => ({ name: nextName(view, value), vary: view.varyOn ? { [view.varyOn]: value } : undefined })),
    keep: {
      contract: doc.contract, inputs: doc.inputs,
      source: "the reference candidate's source refs; cite no new fact",
      recordIds, status: "draft (no status key; pins are unchanged)",
    },
    reference: reference?.name ?? null,
    held: view.candidates.map(c => ({ name: c.name, vary: c.vary ? c.vary.value : "baseline", pinned: c.pinned })),
    writer: view.agent === "director" ? "Director skill (packages/strategist/skill)" : view.agent === "writer" ? "Writer skill (packages/writer/skill)" : `${view.agent} skill`,
    how: "one pass per L2 group with shared context; write each through writeCandidate (records/slot-write.ts)",
  };
}

function line(view: SlotOptions): string {
  return `${`${view.agent}/${view.slot}`.padEnd(48)} ${String(view.distinct)}/${view.options}${view.varyOn ? ` ${view.varyOn}` : ""} pin:${view.pinStatus}`;
}

export async function runOptionsCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parse(argv, OPTIONS_USAGE, ["--more", "--classes", "--check"]);
  if (flags.help) return { exitCode: 0, message: OPTIONS_USAGE };
  const consumer = consumerOf(cwd, flags.root);
  if (flags.classes) {
    if (flags.positional.length || flags.more) throw new CliUsageError(`--classes takes no slot\n${OPTIONS_USAGE}`);
    const changed: string[] = [];
    for (const agent of SLOT_AGENTS) {
      if (!OPTION_TABLE.groups[agent]) continue;
      for (const entry of listSlots(consumer, agent)) {
        const classId = classify(agent, entry.id, `${entry.position.l1}/${entry.position.l2}`)?.classId;
        const klass = classId ? OPTION_TABLE.classes[classId] : undefined;
        if (!klass) continue;
        const doc = inspectSlot(consumer, agent, entry.id).doc;
        const want = klass.options > 1 ? `${klass.options}/${klass.varyOn}` : "1/";
        const have = `${doc.options ?? 1}/${(doc.options ?? 1) > 1 ? doc.varyOn ?? "" : ""}`;
        if (want === have && (klass.options > 1 || doc.varyOn === undefined)) continue;
        if (!flags.check) writeSlotOptions(consumer, agent, entry.id, { options: klass.options, ...(klass.varyOn ? { varyOn: klass.varyOn } : {}) });
        changed.push(`${agent}/${entry.id}`);
      }
    }
    const verb = flags.check ? "drift" : "wrote";
    return { exitCode: flags.check && changed.length ? 1 : 0, message: [...changed.map(slot => `${verb} ${slot}`), `options --classes: ${changed.length} slot.json ${flags.check ? "drifted" : "updated"}`].join("\n"), output: { changed } };
  }
  if (flags.check) throw new CliUsageError(`--check is only for --classes\n${OPTIONS_USAGE}`);
  if (!flags.positional.length) {
    if (flags.more) throw new CliUsageError(`--more needs <agent>/<slot>\n${OPTIONS_USAGE}`);
    const { findings, slots } = checkSlotOptions(consumer);
    const choice = slots.filter(slot => slot.options > 1);
    const lines = choice.map(line);
    lines.push(`options: ${choice.length} choice slot(s); classes ${JSON.stringify(classCounts(slots))}; ${findings.length} finding(s)`);
    return { exitCode: 0, message: lines.join("\n"), output: { classes: classCounts(slots), slots: choice, findings } };
  }
  if (flags.positional.length > 1) throw new CliUsageError(`Unexpected argument: ${flags.positional[1]}\n${OPTIONS_USAGE}`);
  const { agent, id } = target(flags.positional[0], OPTIONS_USAGE);
  const entry = readSlotEntry(consumer, agent, id);
  if (!entry) return { exitCode: 1, message: `options refused: unknown slot ${agent}/${id} (not in ${agent} ia.json)` };
  const view = slotOptions(consumer, entry);
  if (flags.more) {
    const brief = optionsBrief(consumer, view);
    return { exitCode: 0, message: JSON.stringify(brief, null, 2), output: brief };
  }
  const lines = [line(view), ...view.candidates.map(c => `  ${c.pinned ? "*" : " "} ${c.name.padEnd(40)} ${c.vary ? `${c.vary.axis}=${c.vary.value}` : "baseline"}`)];
  if (view.missing.length && view.options > 1) lines.push(`  missing ${view.varyOn}: ${view.missing.join(", ")} (clossys options ${agent}/${id} --more)`);
  return { exitCode: 0, message: lines.join("\n"), output: view };
}

export async function runPickCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parse(argv, PICK_USAGE, ["--by", "--at"]);
  if (flags.help) return { exitCode: 0, message: PICK_USAGE };
  const [raw, candidateId, ...extra] = flags.positional;
  if (extra.length) throw new CliUsageError(`Unexpected argument: ${extra[0]}\n${PICK_USAGE}`);
  const { agent, id } = target(raw, PICK_USAGE);
  if (!candidateId) throw new CliUsageError(`pick requires <candidate-id>\n${PICK_USAGE}`);
  if (!flags.by || !/^agent:\S+$/.test(flags.by)) throw new CliUsageError(`pick requires --by agent:<seat>; owners pin with clossys pin\n${PICK_USAGE}`);
  const at = flags.at ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) throw new CliUsageError(`--at must be an ISO timestamp\n${PICK_USAGE}`);
  const consumer = consumerOf(cwd, flags.root);
  const entry = readSlotEntry(consumer, agent, id);
  if (!entry) return { exitCode: 1, message: `pick refused: unknown slot ${agent}/${id} (not in ${agent} ia.json)` };
  const candidate = resolveCandidate(entry.candidates, candidateId);
  if (!candidate) return { exitCode: 1, message: `pick refused: ${agent}/${id} has no candidate ${candidateId}` };
  if (optionPinStatus(entry.pin) === "picked") return { exitCode: 1, message: `pick refused: ${agent}/${id} already holds an owner pick (${entry.pin!.candidate} by ${entry.pin!.decidedBy}); only the owner changes it with clossys pin` };
  try {
    const pin = writePin(consumer, agent, id, candidate, { decidedBy: flags.by, at, basis: "agent" });
    return { exitCode: 0, message: `${agent}/${id}: picked ${pin.candidate} (${pin.sha256.slice(0, 12)}) by ${pin.decidedBy}; confirm until the owner pins`, decision: { slot: `${agent}/${id}`, state: "pinned", ...pin } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, message: message.startsWith("pin refused") ? message.replace("pin refused", "pick refused") : `pick refused: ${message}` };
  }
}
