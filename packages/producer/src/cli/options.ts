/**
 * `clossys options` and `clossys pick` (CANDIDATE-OPTIONS): variety to choose from.
 *
 *   clossys options [--root <dir>] [--json]                     every choice slot: options held vs required
 *   clossys options --classes [--check] [--root <dir>] [--json] write (or check) slot.json options/varyOn from the class mapping
 *   clossys options <agent>/<slot> --check [--root <dir>] [--json]
 *       certifies every candidate of the slot (the pin gate's verdict: submit record and certify) and judges the
 *       submitted, certified ones by the options rules: exit 0 when the slot holds the options its family owes
 *       (loop.create's certify and loop.choose's rank step), 1 naming why; writes clossys/.state/checks/<agent>/<slot>/certify.json.
 *   clossys options <agent>/<slot> [--more | --redraft] [--root <dir>] [--json]
 *       lists the slot's candidates with their variation and pin status; --more prints the
 *       generation brief for 2-3 fresh candidates that keep the reference's sources (variety);
 *       --redraft prints the brief for one re-drafted candidate that may cite new evidence
 *       (a project re-draft, the answer to a request gap). The CLI never writes candidates:
 *       the owning agent submits each through `clossys next <agent>/<slot> --submit`.
 *   clossys options designer/<slot> --reference [--root <dir>] [--json]
 *       prints what the slot's candidate is built from: the stock item the adopt path (loop.create's
 *       `clossys settle adopt` step) installs, its files exactly as that path writes them, and the step skill's text.
 *   clossys pick <agent>/<slot> <candidate-id> --by agent:<seat> [--at <iso>] [--root <dir>] [--json]
 *       a judge seat picks one candidate: pin.json with basis "agent", shown as "confirm"
 *       in Studio until the owner pins with `clossys pin`.
 */
import { refuseLegacyState, statePath } from "../engine/state-dir.js";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CERTIFY_REPORT_SCHEMA, certifiedOptions } from "../constitution/pin-gate.js";
import { OPTION_TABLE, SLOT_AGENTS, type SlotAgent } from "../records/slot-model/index.js";
import { checkSlotOptions, classCounts, classify, slotOptions, type SlotOptions } from "../records/slot-options.js";
import { inspectSlot, listSlots, modelExists, readCandidate, readSlotEntry } from "../records/slots.js";
import { writeSlotOptions } from "../records/slot-write.js";
import { readPinFile } from "../records/pin-map.js";
import { AGENT_CREATES, CODE_ADOPT_CLI, CODE_ADOPT_RUNG, CODE_ADOPT_SKILL, agentCreatesText, codeAdoptSlotRefusal, stockFilesOf, stockItemOf } from "../records/code-adopt.js";
import { adoptDependencyPreview, dependencyPlanText } from "../records/adopt-dependencies.js";
import { skillFor } from "../loop/slots.js";
import { packagePath } from "../package-path.js";
import { pinRecordStatus } from "../records/pin.js";
import "../constitution/guard.js"; // registers the write guard's runner
import { CliUsageError } from "./args.js";
import { errorMessage } from "../errors.js";
import type { CliResult } from "./main.js";
import { isTargetSlot, oldSlotRefusal, pinTargetSlot, resolveCandidate } from "./pin.js";
import { seatRefusal } from "../records/seat-owner.js";
import { discoverRoot } from "./root.js";

export const OPTIONS_USAGE = "Usage: clossys options [<agent>/<slot> [--more | --redraft | --check]] [--root <dir>] [--json]\n"
  + "       clossys options designer/<slot> --reference [--root <dir>] [--json]\n"
  + "       clossys options --classes [--check] [--root <dir>] [--json]\n"
  + "  lists a slot's candidates by variation; --more prints the brief for 2-3 fresh candidates on the reference's sources,\n"
  + "  --redraft the brief for one re-drafted candidate that may cite new evidence (the owning agent submits each with clossys next --submit).\n"
  + "  <agent>/<slot> --check certifies every candidate and exits 1 unless the submitted, certified ones hold the options\n"
  + "  the slot's family owes (loop.create's certify step); it writes clossys/.state/checks/<agent>/<slot>/certify.json.\n"
  + "  --reference prints what a Designer slot's candidate is built from: the reference (stock) item, its manifest hash (the\n"
  + "  meta.source.hash a registry ref needs), its files exactly as the adopt path writes them (loop.create's step " + CODE_ADOPT_CLI + ",\n"
  + "  run with clossys run loop.create --slot designer/<slot>, installs it unmodified into an empty byte-exact adopt slot) and\n"
  + "  the text of the step skill. When the item imports a package the consumer lockfile lacks, it prints the dependency change\n"
  + "  that run makes and exits 0; a package no manifest row declares exits 1 (request the reference manifest). It writes\n"
  + "  nothing. No stock item refuses: " + AGENT_CREATES + ".\n"
  + "  --classes writes slot.json options/varyOn from the committed option-class mapping; --check only reports drift.";
export const PICK_USAGE = "Usage: clossys pick <agent>/<slot> <candidate-id> --by agent:<seat> [--at <iso timestamp>] [--root <dir>] [--json]\n"
  + "  a judge seat picks one candidate (pin basis agent); Studio shows it as confirm until the owner pins. An agent's seat\n"
  + "  (agent:<agent>[.<role>]) picks only on that agent's own slots.";

interface Flags { positional: string[]; more: boolean; redraft: boolean; reference: boolean; classes: boolean; check: boolean; by?: string; at?: string; root?: string; help: boolean }

function parse(argv: readonly string[], usage: string, allowed: readonly string[]): Flags {
  const flags: Flags = { positional: [], more: false, redraft: false, reference: false, classes: false, check: false, help: false };
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
    else if (arg === "--redraft") flags.redraft = true;
    else if (arg === "--reference") flags.reference = true;
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
export function optionsBrief(consumer: string, view: SlotOptions, mode: "more" | "redraft" = "more"): Record<string, unknown> {
  const doc = inspectSlot(consumer, view.agent, view.slot).doc;
  const fill = view.missing.length ? view.missing : view.values;
  const count = mode === "redraft" ? 1 : Math.min(3, Math.max(2, view.options - view.distinct, view.missing.length));
  const values = mode === "redraft" && !fill.length ? [undefined] : fill.slice(0, count);
  const reference = view.candidates.find(c => c.pinned) ?? view.candidates[0];
  const referenceBytes = reference ? readCandidate(consumer, view.agent, view.slot, reference.name).bytes : "";
  const recordIds = [...referenceBytes.matchAll(/^<!-- (\{.*\}) -->$/gm)].map(match => {
    try { return (JSON.parse(match[1]!) as { id?: string }).id; }
    catch (error) { throw new Error(`${view.agent}/${view.slot}/${reference!.name}: malformed record line ${match[0]}: ${errorMessage(error)}`); }
  }).filter(Boolean);
  return {
    slot: `${view.agent}/${view.slot}`, group: view.group, class: view.classId, varyOn: view.varyOn,
    mode,
    write: values.map(value => ({ name: value === undefined ? nextName(view, "redraft") : nextName(view, value), vary: view.varyOn && value !== undefined ? { [view.varyOn]: value } : undefined })),
    keep: {
      contract: doc.contract, inputs: doc.inputs,
      source: mode === "redraft"
        ? "the reference candidate's source refs plus any new evidence recorded first with clossys evidence; every new fact cites one"
        : "the reference candidate's source refs; cite no new fact (a re-draft on new evidence is clossys options --redraft)",
      recordIds, status: "draft (no status key; pins are unchanged)",
    },
    reference: reference?.name ?? null,
    held: view.candidates.map(c => ({ name: c.name, vary: c.vary ? c.vary.value : "baseline", pinned: c.pinned })),
    writer: view.agent === "director" ? "Director skill (packages/director/skill)" : view.agent === "writer" ? "Writer skill (packages/writer/skill)" : `${view.agent} skill`,
    how: `one pass per L2 group with shared context; submit each file with clossys next ${view.agent}/${view.slot} --submit <file> --model <id> --tier <tier> --basis agent --skill <the step's skill path> --rung <rung> [--seed <id>] [--reason <text>] (adopt a seed verbatim first, adapt one only when none fits, create only when none can be adapted, with the reason); a byte-identical candidate is refused`,
  };
}

/**
 * `--reference`: what `designer/<id>`'s candidate is built from, read through the verb alone: the stock item the adopt
 * path installs (records/code-adopt.ts stockItemOf, the same call loop.create's `clossys settle adopt` step writes
 * from), its manifest hash (the `meta.source.hash` a cited registry ref needs), its files exactly as that path writes
 * them, and the text of the step skill a candidate cites. Read-only: it writes nothing and runs nothing.
 *
 * CP1-PKGS: when the item's only bar is a package the consumer lockfile does not hold, it prints the item, its hash,
 * the adopt step's dependency change (records/adopt-dependencies.ts adoptDependencyPreview, the step's own read) and
 * the one verb that applies it, `clossys run loop.create --slot designer/<id>`, exit 0. A change the step refuses (an
 * import no manifest row of the item declares) exits 1, names the package and says to request the reference manifest.
 * No stock item, or a slot of another agent, refuses: there is no fallback reference.
 */
export function optionsReference(root: string, agent: SlotAgent, id: string): CliResult {
  const at = `${agent}/${id}`;
  if (agent !== "designer") return { exitCode: 1, message: `options refused: --reference reads a Designer slot's stock item, and ${at} is a ${agent} slot (no registry item ships it)` };
  let found: ReturnType<typeof stockItemOf>;
  try { found = stockItemOf(root, id); }
  catch (error) { return { exitCode: 1, message: `options refused: ${at} has no reference item: ${errorMessage(error)}` }; }
  const skillPath = skillFor(root, CODE_ADOPT_SKILL, agent)!;
  const skill = { path: skillPath, text: readFileSync(packagePath(root, skillPath), "utf8") };
  const run = `clossys run loop.create --slot ${at}`;
  if ("none" in found) return unlockedReference(root, at, id, found.none, run, skill);
  const { stock } = found;
  const notCode = codeAdoptSlotRefusal(root, agent, id);
  const held = readSlotEntry(join(root, "clossys"), agent, id)?.candidates ?? [];
  const byCode = notCode === undefined && held.length === 0;
  const adopt = {
    step: CODE_ADOPT_CLI, run, rung: CODE_ADOPT_RUNG, seed: stock.seed, byCode,
    why: notCode ?? (held.length ? `${at} holds ${held.join(", ")}; code adopts only into a slot with no candidate` : `code installs ${stock.ref} unmodified at rung ${CODE_ADOPT_RUNG}`),
  };
  const output = { slot: at, reference: stock.ref, seed: stock.seed, hash: stock.row.hash, item: stock.item, adopt, skill };
  const lines = [
    `${at}: reference ${stock.ref} (seed ${stock.seed}), hash ${stock.row.hash}, ${stock.item.files.length} file(s); dependencies ${stock.item.dependencies.join(", ") || "none"}`,
    `adopt: ${byCode ? `${adopt.run} installs it unmodified (${CODE_ADOPT_CLI}, rung ${CODE_ADOPT_RUNG})` : `code does not adopt here (${adopt.why}); submit it yourself at rung ${CODE_ADOPT_RUNG} --seed ${stock.seed}`}`,
    ...stock.item.files.flatMap(file => [`--- file ${file.path}`, file.content]),
    `--- skill ${skill.path}`, skill.text,
  ];
  return { exitCode: 0, message: lines.join("\n"), output };
}

/**
 * `--reference` when stockItemOf finds no item (`none`): a stock row that ships the slot's fixture but imports a package
 * the consumer lockfile does not hold prints its item, hash, the adopt step's dependency change and the verb that
 * applies it (exit 0), or the step's refusal (exit 1); no stock row refuses with what create means (AGENT_CREATES).
 */
function unlockedReference(root: string, at: string, id: string, none: string, run: string, skill: { path: string; text: string }): CliResult {
  let files: ReturnType<typeof stockFilesOf>;
  try { files = stockFilesOf(root, id); }
  catch (error) { return { exitCode: 1, message: `options refused: ${at} has no reference item: ${errorMessage(error)}` }; }
  if ("none" in files) return { exitCode: 1, message: `options refused: ${at} has no reference item: ${none}; ${agentCreatesText(at)}` };
  const { row, ref } = files;
  let preview: ReturnType<typeof adoptDependencyPreview>;
  try { preview = adoptDependencyPreview(root, "designer", id); }
  catch (error) { return { exitCode: 1, message: `options refused: ${at}'s reference ${ref} cannot be planned: ${errorMessage(error)}` }; }
  if ("refused" in preview) {
    const request = `clossys request --kind change --subject ${at} --from ${at} --want contract --why "${ref}: its reference manifest rows do not declare a package it imports"`;
    return { exitCode: 1, message: `options refused: ${at}'s reference ${ref} (hash ${row.hash}): ${preview.refused}. No clossys step installs an undeclared package: file a request for the reference manifest (${request}); ${agentCreatesText(at)}`, output: { slot: at, reference: ref, hash: row.hash, refused: preview.refused, request } };
  }
  if ("skip" in preview) return { exitCode: 1, message: `options refused: ${at} has no reference item: ${none}, and no clossys step adds it here (${preview.skip})` };
  const change = dependencyPlanText(preview.plan);
  const then = preview.adopts
    ? `then installs ${ref} unmodified (${CODE_ADOPT_CLI}, rung ${CODE_ADOPT_RUNG}, seed ${row.registry}/${row.name})`
    : `and adopts no candidate (${preview.crafted}): craft it from this reference after the run`;
  const apply = `${run} adds them (one logged dependency.add event), ${then}; options writes nothing, and you never run npm`;
  const item = { name: id.split(".").at(-1)!, type: row.type, files: files.files };
  const output = { slot: at, reference: ref, seed: `${row.registry}/${row.name}`, hash: row.hash, item, dependencies: { plan: preview.plan, change }, apply: { run, adopts: preview.adopts }, skill };
  const lines = [
    `${at}: reference ${ref} (seed ${row.registry}/${row.name}), hash ${row.hash}, ${files.files.length} file(s); ${none}`,
    `dependencies: ${change}`,
    `apply: ${apply}`,
    ...files.files.flatMap(file => [`--- file ${file.path}`, file.content]),
    `--- skill ${skill.path}`, skill.text,
  ];
  return { exitCode: 0, message: lines.join("\n"), output };
}

function line(view: SlotOptions): string {
  return `${`${view.agent}/${view.slot}`.padEnd(48)} ${String(view.distinct)}/${view.options}${view.varyOn ? ` ${view.varyOn}` : ""} pin:${view.pinStatus}`;
}

export async function runOptionsCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parse(argv, OPTIONS_USAGE, ["--more", "--redraft", "--reference", "--classes", "--check"]);
  if (flags.more && flags.redraft) throw new CliUsageError(`--more and --redraft are two briefs; pass one\n${OPTIONS_USAGE}`);
  if (flags.reference && (flags.more || flags.redraft || flags.check || flags.classes)) throw new CliUsageError(`--reference takes one <agent>/<slot> and no other mode\n${OPTIONS_USAGE}`);
  if (flags.help) return { exitCode: 0, message: OPTIONS_USAGE };
  const consumer = consumerOf(cwd, flags.root);
  if (flags.classes) {
    if (flags.positional.length || flags.more || flags.redraft) throw new CliUsageError(`--classes takes no slot\n${OPTIONS_USAGE}`);
    const changed: string[] = [], unplaced: string[] = [], refused: string[] = [];
    for (const agent of SLOT_AGENTS) {
      if (!OPTION_TABLE.groups[agent]) continue;
      for (const entry of listSlots(consumer, agent)) {
        // An IA slot with no slot.json is an open ia item (clossys next), not an options drift: listed, never written.
        if (!modelExists(join(entry.dir, "slot.json"))) { unplaced.push(`${agent}/${entry.id}`); continue; }
        const classId = classify(agent, entry.id, `${entry.position.l1}/${entry.position.l2}`)?.classId;
        const klass = classId ? OPTION_TABLE.classes[classId] : undefined;
        if (!klass) continue;
        const doc = inspectSlot(consumer, agent, entry.id).doc;
        const want = klass.options > 1 ? `${klass.options}/${klass.varyOn}` : "1/";
        const have = `${doc.options ?? 1}/${(doc.options ?? 1) > 1 ? doc.varyOn ?? "" : ""}`;
        if (want === have && (klass.options > 1 || doc.varyOn === undefined)) continue;
        // One format (U13): an old-format slot is never rewritten in place; it is named, and the run exits 1.
        if (!flags.check && !isTargetSlot(dirname(consumer), agent, entry.id)) { refused.push(oldSlotRefusal("options", `${agent}/${entry.id}`)); continue; }
        if (!flags.check) writeSlotOptions(consumer, agent, entry.id, { options: klass.options, ...(klass.varyOn ? { varyOn: klass.varyOn } : {}) });
        changed.push(`${agent}/${entry.id}`);
      }
    }
    const verb = flags.check ? "drift" : "wrote";
    const open = unplaced.length ? `; ${unplaced.length} IA slot(s) have no slot.json yet (open ia items: clossys next)` : "";
    return { exitCode: (flags.check && changed.length) || refused.length ? 1 : 0, message: [...changed.map(slot => `${verb} ${slot}`), ...refused, ...unplaced.map(slot => `ia gap ${slot}: no slot.json`), `options --classes: ${changed.length} slot.json ${flags.check ? "drifted" : "updated"}${refused.length ? `, ${refused.length} refused` : ""}${open}`].join("\n"), output: { changed, unplaced, ...(refused.length ? { refused } : {}) } };
  }
  if (flags.check) {
    if (flags.positional.length !== 1 || flags.more || flags.redraft) throw new CliUsageError(`--check takes --classes or one <agent>/<slot>\n${OPTIONS_USAGE}`);
    const { agent, id } = target(flags.positional[0], OPTIONS_USAGE);
    if (!readSlotEntry(consumer, agent, id)) return { exitCode: 1, message: `options refused: unknown slot ${agent}/${id} (not in ${agent} ia.json)` };
    const root = dirname(consumer);
    const at = new Date().toISOString();
    const judged = certifiedOptions(root, consumer, agent, id, at);
    const report = { schema: CERTIFY_REPORT_SCHEMA, slot: `${agent}/${id}`, at, ok: judged.ok, distinct: judged.distinct, options: judged.options, why: judged.why, candidates: judged.scorecard.candidates };
    refuseLegacyState(root);
    const dir = statePath(root, "checks", agent, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "certify.json"), `${JSON.stringify(report, null, 2)}\n`);
    const rows = judged.scorecard.candidates.map(row => `  ${row.submitted && row.certified ? "pass" : "fail"} ${row.candidate}${row.submitted ? "" : " (no matching submit record)"}${row.reasons.length ? `: ${row.reasons.map(reason => `[${reason.code}] ${reason.message}`).join("; ")}` : ""}`);
    const head = `${agent}/${id}: ${judged.ok ? "certified" : "not certified"}, ${judged.distinct}/${judged.options} option(s) among the submitted, certified candidates`;
    return { exitCode: judged.ok ? 0 : 1, message: [head, ...rows, ...(judged.ok ? [] : judged.why.map(line => `  why: ${line}`))].join("\n"), output: report };
  }
  if (!flags.positional.length) {
    if (flags.more || flags.redraft || flags.reference) throw new CliUsageError(`${flags.more ? "--more" : flags.redraft ? "--redraft" : "--reference"} needs <agent>/<slot>\n${OPTIONS_USAGE}`);
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
  if (!modelExists(join(entry.dir, "slot.json"))) return { exitCode: 1, message: `options: ia gap ${agent}/${id}: the IA places it, but it has no slot.json yet (an open ia item: clossys next)` };
  if (flags.reference) return optionsReference(dirname(consumer), agent, id);
  const view = slotOptions(consumer, entry);
  if (flags.more || flags.redraft) {
    const brief = optionsBrief(consumer, view, flags.redraft ? "redraft" : "more");
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
  // No cross-edit: the pin writer itself runs the shared seat guard (records/seat-owner.ts assertSeat) for a pick.
  const consumer = consumerOf(cwd, flags.root);
  // One format (foundry-build-0048 U13): a pick writes clossys.pin/2 (or one pin-map record) through the gated pin path,
  // on a clossys.slot/2 slot only; it never writes a clossys.pin/1.
  const workspace = dirname(consumer);
  const slotId = id.split("#")[0]!;
  // The seat rule judges who acts before the format refusal judges what is written: a foreign seat is refused by name.
  const crossing = seatRefusal(flags.by, agent);
  if (crossing !== undefined) return { exitCode: 1, message: `pick refused: ${crossing}` };
  if (!isTargetSlot(workspace, agent, slotId)) return { exitCode: 1, message: oldSlotRefusal("pick", `${agent}/${slotId}`) };
  return pickTargetSlot(workspace, agent, id, candidateId, flags.by, at);
}

/** A pick on a clossys.slot/2 slot: an agent pin (basis agent) that never replaces an owner's pick. */
function pickTargetSlot(workspace: string, agent: SlotAgent, target: string, candidateId: string, by: string, at: string): CliResult {
  const hash = target.indexOf("#");
  const slotId = hash < 0 ? target : target.slice(0, hash);
  const record = hash < 0 ? undefined : target.slice(hash + 1);
  const dir = join(workspace, "clossys", "agents", agent, slotId);
  let names: string[] = [];
  try { names = readdirSync(join(dir, "candidates")).filter(name => !name.startsWith(".")); } catch { names = []; }
  const candidate = resolveCandidate(names, candidateId) ?? (names.filter(name => name.replace(/\.svg$/, "") === candidateId).length === 1 ? `${candidateId}.svg` : undefined);
  if (!candidate) return { exitCode: 1, message: `pick refused: ${agent}/${slotId} has no candidate ${candidateId}` };
  const held = readPinFile(join(dir, "pin.json"), { agent, slotId });
  const owner = held.kind === "pin" ? held.doc : held.kind === "pin-map" && record !== undefined ? held.doc.records[record] : undefined;
  if (owner && pinRecordStatus(owner) === "pinned") return { exitCode: 1, message: `pick refused: ${agent}/${target} already holds an owner pick (${owner.candidate} by ${owner.decidedBy}); only the owner changes it with clossys pin` };
  const result = pinTargetSlot(workspace, agent, target, candidate, { by, basis: "agent", at });
  if (result.exitCode !== 0) return { ...result, message: result.message.replace(/^pin refused/, "pick refused") };
  return { ...result, message: `${agent}/${target}: picked ${candidate} by ${by}; confirm until the owner pins` };
}

