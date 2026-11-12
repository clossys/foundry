/**
 * The owner verbs: each records one owner decision step (W6a; they replace the six gaps).
 *
 *   clossys ia <agent>/<slot> --contract <file> [--under <l1>/<l2>] [--kind <kind>] [--inputs <id,...>] [--uses <id,...>] [--root <dir>]
 *   clossys ia <agent>/<slot> --remove [--root <dir>]
 *   clossys evidence <id> --source <source> --observed <YYYY-MM-DD> --by <who> --body <file> [--finding] [--root <dir>]
 *   clossys config --init [--from <file>] [--root <dir>]
 *   clossys seat <step> --by <who> (--model <id> --tier low|mid|high --prompt-file <path> | --no-llm) [--procedure <text> --command <verb>] [--decided-by owner|planner] [--root <dir>]
 *   clossys rule --init [--root <dir>]
 *   clossys rule <R-ID> --quote <text> --date <YYYY-MM-DD> --status enforced|unenforced|pending-wire [--check <id>]... [--fixture <path>] [--fixture-run <cmd>]... [--note <text>] [--replace] [--root <dir>]
 *   clossys approve writer/<slot> <candidate-id> [--by owner[:<ref>]] [--at <iso>] [--root <dir>]
 *
 * Every write is validated against its schema and the slot model check: a write that adds a slot
 * model issue is rolled back and refused (exit 1). A refusal is recorded like any run (exit 1).
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkSlotModel } from "../records/slot-check.js";
import { AGENT_KIND, CANDIDATE_NAME, FOUNDRY_IA_AFTER, FOUNDRY_IA_AGENTS, IA_SCHEMA, SLOT_AGENTS, SLOT_ID, SLOT_KINDS, SLOT_SCHEMA } from "../records/slot-model/types.js";
import type { IaDoc, SlotAgent, SlotKind } from "../records/slot-model/types.js";
import { candidatesDir, iaPath, jsonBytes, pinFile, seatDir, slotDir, slotFile } from "../records/slot-model/layout.js";
import { designerIa, directorIa, slotPositions, writerIa, type FoundryIa } from "../records/slot-model/foundry-ia.js";
import { deriveRefs, feedsIndex } from "../records/slot-model/derive.js";
import { validateIa, validatePin, validateSlotDoc } from "../records/slot-model/validate.js";
import { readSlotEntry } from "../records/slots.js";
import { writePin } from "../records/slot-write.js";
import { isDecide, roundOf, ROUNDS, stageName, STAGES } from "../pipeline/define.js";
import type { Step } from "../pipeline/define.js";
import { loadSchema, validateFile, validateValue } from "../pipeline/schema.js";
import { readSeat } from "../pipeline/seats.js";
import { SEAT_POLICY_FILE, SEAT_POLICY_SCHEMA, validateSeatPolicy } from "../pipeline/seat-policy.js";
import { writerKeysUnapproved } from "../pipeline/status.js";
import { STEPS } from "../pipeline/steps/index.js";
import { resolveCandidate } from "./pin.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const IA_USAGE = "Usage: clossys ia <agent>/<slot> --contract <file> [--under <l1>/<l2>] [--kind <kind>] [--inputs <id,...>] [--uses <id,...>] [--root <dir>]\n"
  + "       clossys ia <agent>/<slot> --remove [--root <dir>]\n"
  + "       clossys ia <agent> --adopt | --start [--root <dir>]\n"
  + "  places a slot in its agent's ia.json (--under, when it is not placed yet) and writes its slot.json with the contract (a JSON object file).\n"
  + "  --adopt writes the agent's Foundry IA (ia.json and every slot.json, inputs and uses derived) where it has no ia.json (Director, Designer, Writer; the Director's first).\n"
  + "  --start writes an empty workspace IA instead; --under then adds its L1/L2 groups as it places each slot.";
export const EVIDENCE_USAGE = "Usage: clossys evidence <id> --source <source> --observed <YYYY-MM-DD> --by <who> --body <file> [--finding] [--root <dir>]\n"
  + "  writes clossys/evidence/director/<id>.md (--finding: findings/<id>.md), the evidence the Director cites.";
export const CONFIG_USAGE = "Usage: clossys config --init [--from <file>] [--root <dir>]\n"
  + "  writes clossys/clossys.config.ts (the default config, or --from a config file) when the workspace has none; with one, validates it.";
export const SEAT_USAGE = "Usage: clossys seat <step> --by <who> (--model <id> --tier low|mid|high | --llm-from <step>) --prompt-file <path> [--procedure <text> --command <verb>] [--decided-by owner|planner] [--root <dir>]\n"
  + "       clossys seat <step> --by <who> --no-llm [--procedure <text> --command <verb>] [--decided-by owner|planner] [--root <dir>]\n"
  + "       clossys seat --policy (--model <tier>=<id>... | --human-only) [--root <dir>]\n"
  + "  records who decides a decide step: a new seat candidate and its pin; places the seat in producer ia.json when it is not placed.\n"
  + "  --llm-from <step>: the llm (model and tier) of that step's assigned seat (a pick seat takes its candidates seat's llm).\n"
  + "  --policy: writes clossys/seat-policy.json, the model id of each seat tier the seat answers fill (never guessed).";
export const RULE_USAGE = "Usage: clossys rule --init [--root <dir>]\n"
  + "       clossys rule <R-ID> --quote <text> --date <YYYY-MM-DD> --status enforced|unenforced|pending-wire [--check <id>]... [--fixture <path>] [--fixture-run <cmd>]... [--note <text>] [--replace] [--root <dir>]\n"
  + "  adds (or with --replace, replaces) one owner rule row in scripts/rules/registry.json, starting the registry when it has none.";
export const APPROVE_USAGE = "Usage: clossys approve writer/<slot> <candidate-id> [--by owner[:<ref>]] [--at <iso>] [--root <dir>]\n"
  + "  the owner approves a Writer candidate's copy: it is pinned (basis picked) and its keys are approved.";

// ---------------------------------------------------------------- shared
interface Flags { positional: string[]; values: Map<string, string[]>; bare: Set<string>; help: boolean }
function parser(usage: string, valued: readonly string[], bare: readonly string[]) {
  return (argv: readonly string[]): Flags => {
    const flags: Flags = { positional: [], values: new Map(), bare: new Set(), help: false };
    for (let index = 0; index < argv.length; index++) {
      const arg = argv[index]!;
      if (arg === "--json") continue;
      if (arg === "--help") { flags.help = true; continue; }
      if (bare.includes(arg)) { flags.bare.add(arg); continue; }
      if (valued.includes(arg)) {
        const next = argv[++index];
        if (next === undefined || (next.startsWith("--") && next.length > 2)) throw new CliUsageError(`${arg} requires a value\n${usage}`);
        flags.values.set(arg, [...(flags.values.get(arg) ?? []), next]);
        continue;
      }
      if (arg.startsWith("--")) throw new CliUsageError(`Unknown argument: ${arg}\n${usage}`);
      flags.positional.push(arg);
    }
    return flags;
  };
}
const one = (flags: Flags, name: string): string | undefined => flags.values.get(name)?.at(-1);
const need = (flags: Flags, name: string, usage: string): string => {
  const value = one(flags, name);
  if (value === undefined || !value.trim()) throw new CliUsageError(`${name} is required\n${usage}`);
  return value;
};
const rootOf = (cwd: string, flags: Flags) => discoverRoot(resolve(cwd, one(flags, "--root") ?? "."));
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const refuse = (verb: string, message: string): CliResult => ({ exitCode: 1, message: `${verb} refused: ${message}` });

/** Write by renaming a fully written sibling over the target: a reader sees the old bytes or the new. */
function replaceFile(path: string, bytes: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const staged = join(dirname(path), `.${randomUUID()}.tmp`);
  writeFileSync(staged, bytes, { flag: "wx" });
  try { renameSync(staged, path); } catch (error) { rmSync(staged, { force: true }); throw error; }
}
/** The files a write touches, as they were, so a refused write is undone byte for byte. */
function snapshot(paths: readonly string[]): () => void {
  const before = paths.map(path => ({ path, bytes: existsSync(path) ? readFileSync(path, "utf8") : null }));
  return () => { for (const entry of before) { if (entry.bytes === null) rmSync(entry.path, { force: true }); else replaceFile(entry.path, entry.bytes); } };
}
const issueKey = (issue: { code: string; path: string; message: string }) => `${issue.code} ${issue.path} ${issue.message}`;
/** Runs `write`; when the slot model check then has an issue it did not have before, undoes it and returns the issues. */
function guarded(consumer: string, paths: readonly string[], write: () => void): string[] {
  const before = new Set(checkSlotModel(consumer).map(issueKey));
  const undo = snapshot(paths);
  try { write(); } catch (error) { undo(); throw error; }
  const added = checkSlotModel(consumer).map(issueKey).filter(issue => !before.has(issue));
  if (added.length) undo();
  return added;
}
const readJsonFile = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

// ---------------------------------------------------------------- clossys ia
const parseIa = parser(IA_USAGE, ["--contract", "--under", "--kind", "--inputs", "--uses", "--root"], ["--remove", "--adopt", "--start"]);
const FOUNDRY_IA: Readonly<Record<keyof typeof FOUNDRY_IA_AFTER, () => FoundryIa>> = { director: directorIa, designer: designerIa, writer: writerIa };
/** The source of a workspace-owned IA (`--start`): `--under` may add L1/L2 groups to it, never to a Foundry IA. */
export const WORKSPACE_IA_SOURCE = "workspace#owner";

/** `clossys ia <agent> --start`: an empty workspace-owned ia.json, where the agent has none. */
function startIa(agent: string, root: string): CliResult {
  if (!(SLOT_AGENTS as readonly string[]).includes(agent)) throw new CliUsageError(`ia --start takes one of ${SLOT_AGENTS.join(", ")}\n${IA_USAGE}`);
  const consumer = join(root, "clossys"), iaFile = iaPath(consumer, agent as SlotAgent);
  if (existsSync(iaFile)) return refuse("ia", `${agent} ia.json exists; change it slot by slot (--under, --remove)`);
  const doc = { schema: IA_SCHEMA, source: WORKSPACE_IA_SOURCE, extensions: [], nodes: [] };
  const added = guarded(consumer, [iaFile], () => replaceFile(iaFile, jsonBytes(doc)));
  if (added.length) return refuse("ia", `the slot model check fails after the write: ${added.slice(0, 5).join("; ")}`);
  return { exitCode: 0, root, message: `ia: started an empty ${agent} IA (clossys/agents/${agent}/ia.json); place each slot with clossys ia ${agent}/<slot> --under <l1>/<l2> --contract <file>` };
}

/** `clossys ia <agent> --adopt`: the agent's Foundry IA and every slot.json, written only where the agent has no ia.json. */
function adoptIa(agent: string, root: string): CliResult {
  if (!(FOUNDRY_IA_AGENTS as readonly string[]).includes(agent)) throw new CliUsageError(`ia --adopt takes ${FOUNDRY_IA_AGENTS.join(", ")}; the Publisher IA is the workspace's own (ia publisher --start)\n${IA_USAGE}`);
  const read = FOUNDRY_IA[agent as keyof typeof FOUNDRY_IA], after = FOUNDRY_IA_AFTER[agent as keyof typeof FOUNDRY_IA];
  const consumer = join(root, "clossys"), iaFile = iaPath(consumer, agent as SlotAgent);
  if (existsSync(iaFile)) return refuse("ia", `${agent} ia.json exists; change it slot by slot (--under, --remove)`);
  const first = after.filter(up => !existsSync(iaPath(consumer, up)));
  if (first.length) return refuse("ia", `adopt the ${first.join(", ")} IA first: ${agent} slots read its slots`);
  const foundry = read();
  // Refs resolve against the slots this workspace places, plus the adopted ones; the Director's feeds become downstream inputs.
  const known = new Set(foundry.slots.keys());
  for (const other of SLOT_AGENTS) if (other !== agent && existsSync(iaPath(consumer, other))) {
    for (const id of slotPositions(other, readJsonFile(iaPath(consumer, other)) as IaDoc).keys()) known.add(id);
  }
  const feeds = feedsIndex([...(agent === "director" ? foundry : directorIa()).slots.values()].map(slot => [slot.id, slot.feeds] as const), known);
  const writes: [string, string][] = [[iaFile, jsonBytes(foundry.ia)]];
  let dropped = 0;
  for (const [id, position] of slotPositions(agent as SlotAgent, foundry.ia)) {
    const slot = foundry.slots.get(id)!, file = slotFile(slotDir(consumer, agent as SlotAgent, id));
    if (existsSync(file)) return refuse("ia", `clossys/agents/${agent}/${id}/slot.json exists with no ${agent} ia.json; place it with --under or remove it first`);
    const derived = deriveRefs(agent as SlotAgent, slot.kind, id, { inputs: slot.declaredInputs, uses: slot.declaredUses }, { known, feeds });
    dropped += derived.dropped.length;
    const doc = { schema: SLOT_SCHEMA, id, agent, ia: { ...position }, kind: slot.kind, contract: slot.contract, inputs: derived.inputs, uses: derived.uses };
    const issues = validateSlotDoc(doc, file);
    if (issues.length) return refuse("ia", `${agent}/${id}: ${issues.map(issue => issue.message).join("; ")}`);
    writes.push([file, jsonBytes(doc)]);
  }
  const added = guarded(consumer, writes.map(([path]) => path), () => { for (const [path, bytes] of writes) replaceFile(path, bytes); });
  if (added.length) return refuse("ia", `the slot model check fails after the adoption: ${added.slice(0, 5).join("; ")}`);
  const slots = writes.length - 1;
  return { exitCode: 0, root, message: `ia: adopted the ${agent} IA from ${foundry.ia.source} (${foundry.ia.nodes.length} L1, ${slots} slots with their contracts)${dropped ? `; ${dropped} declared refs name no placed slot and were left out` : ""}` };
}
const ids = (value: string | undefined) => value ? value.split(",").map(id => id.trim()).filter(Boolean) : [];

export async function runIaCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parseIa(argv);
  if (flags.help) return { exitCode: 0, message: IA_USAGE };
  const [target, ...extra] = flags.positional;
  const whole = (["--adopt", "--start"] as const).filter(flag => flags.bare.has(flag));
  if (whole.length) {
    if (whole.length > 1 || !target || extra.length || target.includes("/") || flags.bare.has("--remove") || flags.values.size > (flags.values.has("--root") ? 1 : 0)) throw new CliUsageError(`ia ${whole.join(" ")} takes one agent and no other flag but --root\n${IA_USAGE}`);
    return whole[0] === "--adopt" ? adoptIa(target, rootOf(cwd, flags)) : startIa(target, rootOf(cwd, flags));
  }
  if (!target || extra.length) throw new CliUsageError(`ia takes one <agent>/<slot>\n${IA_USAGE}`);
  const slash = target.indexOf("/");
  const agent = target.slice(0, slash) as SlotAgent, slot = target.slice(slash + 1);
  if (!(SLOT_AGENTS as readonly string[]).includes(agent) || !SLOT_ID.test(slot)) throw new CliUsageError(`ia target must be <agent>/<slot> with agent ${SLOT_AGENTS.join(", ")} and a slot id, got ${target}\n${IA_USAGE}`);
  const root = rootOf(cwd, flags), consumer = join(root, "clossys");
  const iaFile = iaPath(consumer, agent);
  if (!existsSync(iaFile)) return refuse("ia", `${agent} has no ia.json: ${(FOUNDRY_IA_AGENTS as readonly string[]).includes(agent) ? `adopt the Foundry IA (clossys ia ${agent} --adopt) or start` : "start"} an empty one (clossys ia ${agent} --start)`);
  const ia = readJsonFile(iaFile) as { extensions?: string[]; nodes: { id: string; label: string; children: { id: string; label: string; slots: string[] }[] }[] } & Record<string, unknown>;
  const dir = slotDir(consumer, agent, slot);
  const placed = ia.nodes.some(node => node.children.some(child => child.slots.includes(slot)));
  if (flags.bare.has("--remove")) {
    if (!placed) return refuse("ia", `${target} is not in ${agent} ia.json`);
    for (const file of [slotFile(dir), pinFile(dir)]) if (existsSync(file)) return refuse("ia", `${target} has ${file.slice(dir.length + 1)}; only a slot with no records leaves the IA`);
    if (existsSync(candidatesDir(dir)) && readdirSync(candidatesDir(dir)).some(name => !name.startsWith("."))) return refuse("ia", `${target} has candidates; only a slot with no records leaves the IA`);
    const next = { ...ia, nodes: ia.nodes.map(node => ({ ...node, children: node.children.map(child => ({ ...child, slots: child.slots.filter(id => id !== slot) })) })), extensions: (ia.extensions ?? []).filter(id => id !== slot) };
    const issues = validateIa(next, iaFile);
    if (issues.length) return refuse("ia", issues.map(issue => issue.message).join("; "));
    const added = guarded(consumer, [iaFile], () => replaceFile(iaFile, jsonBytes(next)));
    if (added.length) return refuse("ia", `the slot model check fails after the removal: ${added.slice(0, 5).join("; ")}`);
    return { exitCode: 0, root, message: `ia: removed ${target} from ${agent} ia.json` };
  }
  const contractFile = need(flags, "--contract", IA_USAGE);
  let contract: unknown;
  try { contract = readJsonFile(resolve(cwd, contractFile)); } catch { return refuse("ia", `--contract ${contractFile} is not a readable JSON file`); }
  let next = ia;
  if (!placed) {
    const under = one(flags, "--under");
    if (!under) throw new CliUsageError(`${target} is not placed yet: --under <l1>/<l2> names where\n${IA_USAGE}`);
    const [l1, l2] = [under.slice(0, under.indexOf("/")), under.slice(under.indexOf("/") + 1)];
    // A workspace IA (--start) gains the L1/L2 groups its slots name; a Foundry IA only takes slots under the groups it lists.
    const own = ia.source === WORKSPACE_IA_SOURCE && under.includes("/");
    let base = ia.nodes;
    if (own && l1 && l2 && !base.some(each => each.id === l1)) base = [...base, { id: l1, label: l1, children: [] }];
    if (own && l1 && l2) base = base.map(each => each.id !== l1 || each.children.some(group => group.id === l2 || group.id === `${l1}.${l2}`) ? each : { ...each, children: [...each.children, { id: l2, label: l2, slots: [] }] });
    const node = base.find(each => each.id === l1);
    const child = node?.children.find(each => each.id === l2 || each.id === `${l1}.${l2}`);
    if (!node || !child) return refuse("ia", `${agent} ia.json has no ${under} (L1/L2 ids as ia.json lists them)`);
    next = { ...ia, nodes: base.map(each => each !== node ? each : { ...each, children: each.children.map(group => group !== child ? group : { ...group, slots: [...group.slots, slot] }) }) };
  } else if (one(flags, "--under")) return refuse("ia", `${target} is already placed; --under only places a new slot`);
  const iaIssues = validateIa(next, iaFile);
  if (iaIssues.length) return refuse("ia", iaIssues.map(issue => issue.message).join("; "));
  const position = slotPositions(agent, next as unknown as IaDoc).get(slot);
  if (!position) return refuse("ia", `${target} has no position in ${agent} ia.json`);
  const existing = existsSync(slotFile(dir)) ? readJsonFile(slotFile(dir)) as Record<string, unknown> : undefined;
  const kind = (one(flags, "--kind") ?? (existing?.kind as string | undefined) ?? AGENT_KIND[agent][0]) as SlotKind;
  if (!(SLOT_KINDS as readonly string[]).includes(kind)) throw new CliUsageError(`--kind must be one of ${SLOT_KINDS.join(", ")}\n${IA_USAGE}`);
  const doc = {
    ...(existing ?? {}), schema: SLOT_SCHEMA, id: slot, agent, ia: { ...position }, kind, contract,
    inputs: flags.values.has("--inputs") ? ids(one(flags, "--inputs")) : (existing?.inputs as string[] | undefined) ?? [],
    uses: flags.values.has("--uses") ? ids(one(flags, "--uses")) : (existing?.uses as string[] | undefined) ?? [],
  };
  const docIssues = validateSlotDoc(doc, slotFile(dir));
  if (docIssues.length) return refuse("ia", docIssues.map(issue => issue.message).join("; "));
  const added = guarded(consumer, [iaFile, slotFile(dir)], () => {
    if (next !== ia) replaceFile(iaFile, jsonBytes(next));
    replaceFile(slotFile(dir), jsonBytes(doc));
  });
  if (added.length) return refuse("ia", `the slot model check fails after the write: ${added.slice(0, 5).join("; ")}`);
  return { exitCode: 0, root, message: `ia: ${target} ${placed ? "contract written" : `placed under ${one(flags, "--under")} and its contract written`} (clossys/agents/${agent}/${slot}/slot.json)` };
}

// ---------------------------------------------------------------- clossys evidence
const parseEvidence = parser(EVIDENCE_USAGE, ["--source", "--observed", "--by", "--body", "--root"], ["--finding"]);

export async function runEvidenceCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parseEvidence(argv);
  if (flags.help) return { exitCode: 0, message: EVIDENCE_USAGE };
  const [id, ...extra] = flags.positional;
  if (!id || extra.length) throw new CliUsageError(`evidence takes one <id>\n${EVIDENCE_USAGE}`);
  const fields = { id, source: need(flags, "--source", EVIDENCE_USAGE), observed: need(flags, "--observed", EVIDENCE_USAGE), by: need(flags, "--by", EVIDENCE_USAGE) };
  for (const [key, value] of Object.entries(fields)) if (/[\r\n]/.test(value)) return refuse("evidence", `${key} must be one line`);
  let body: string;
  const bodyFile = need(flags, "--body", EVIDENCE_USAGE);
  try { body = readFileSync(resolve(cwd, bodyFile), "utf8"); } catch { return refuse("evidence", `cannot read --body ${bodyFile}`); }
  if (!body.trim()) return refuse("evidence", "the body is empty");
  const root = rootOf(cwd, flags);
  const rel = `clossys/evidence/director/${flags.bare.has("--finding") ? "findings/" : ""}${id}.md`;
  const file = join(root, ...rel.split("/"));
  if (existsSync(file)) return refuse("evidence", `${rel} exists; evidence is never rewritten (record a new id)`);
  const bytes = `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n${body.endsWith("\n") ? body : `${body}\n`}`;
  const issues = validateFile("director-evidence", rel, bytes);
  if (issues.length) return refuse("evidence", issues.map(issue => `${issue.path} ${issue.message}`).join("; "));
  replaceFile(file, bytes);
  return { exitCode: 0, root, message: `evidence: wrote ${rel} (${sha(bytes).slice(0, 12)})` };
}

// ---------------------------------------------------------------- clossys config
const parseConfig = parser(CONFIG_USAGE, ["--from", "--root"], ["--init"]);
export const DEFAULT_CONFIG = "export default {};\n";

export async function runConfigCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parseConfig(argv);
  if (flags.help) return { exitCode: 0, message: CONFIG_USAGE };
  if (flags.positional.length || !flags.bare.has("--init")) throw new CliUsageError(`config takes --init\n${CONFIG_USAGE}`);
  // The workspace may not exist yet: --root (or cwd) is the workspace root itself, never discovered.
  const root = resolve(cwd, one(flags, "--root") ?? ".");
  const rel = "clossys/clossys.config.ts";
  const file = join(root, "clossys", "clossys.config.ts");
  if (existsSync(file)) {
    const issues = validateFile("workspace-config", rel, readFileSync(file, "utf8"));
    return issues.length ? refuse("config", `${rel} exists and is invalid: ${issues.map(issue => issue.message).join("; ")}`) : { exitCode: 0, root, message: `config: ${rel} exists and is valid; nothing written` };
  }
  let bytes = DEFAULT_CONFIG;
  const from = one(flags, "--from");
  if (from) { try { bytes = readFileSync(resolve(cwd, from), "utf8"); } catch { return refuse("config", `cannot read --from ${from}`); } }
  const issues = validateFile("workspace-config", rel, bytes);
  if (issues.length) return refuse("config", issues.map(issue => issue.message).join("; "));
  replaceFile(file, bytes);
  return { exitCode: 0, root, message: `config: wrote ${rel}${from ? ` from ${from}` : " (default)"}` };
}

// ---------------------------------------------------------------- clossys seat
const parseSeat = parser(SEAT_USAGE, ["--by", "--model", "--tier", "--prompt-file", "--llm-from", "--procedure", "--command", "--decided-by", "--at", "--root"], ["--no-llm", "--policy", "--human-only"]);

/** `clossys seat --policy`: the seat policy file, validated before it is written; an identical policy writes nothing. */
function runSeatPolicy(flags: Flags, cwd: string): CliResult {
  if (flags.positional.length) throw new CliUsageError(`seat --policy takes no <step>\n${SEAT_USAGE}`);
  const extra = ["--by", "--tier", "--prompt-file", "--llm-from", "--procedure", "--command", "--decided-by", "--at"].filter(flag => flags.values.has(flag));
  if (extra.length || flags.bare.has("--no-llm")) throw new CliUsageError(`seat --policy takes only --model <tier>=<id> or --human-only\n${SEAT_USAGE}`);
  const models: Record<string, string> = {};
  for (const given of flags.values.get("--model") ?? []) {
    const tiered = /^(low|mid|high)=(.+)$/.exec(given);
    if (!tiered) throw new CliUsageError(`seat --policy --model takes <tier>=<id>, got ${given}\n${SEAT_USAGE}`);
    if (/^<.*>$/.test(tiered[2]!)) return refuse("seat", `--model ${given} is a placeholder: give the model id your account policy maps to the tier`);
    models[tiered[1]!] = tiered[2]!;
  }
  const policy = { schema: SEAT_POLICY_SCHEMA, models, humanOnly: flags.bare.has("--human-only") };
  const issues = validateSeatPolicy(policy);
  if (issues.length) return refuse("seat", `seat policy: ${issues.map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
  const root = rootOf(cwd, flags), file = join(root, SEAT_POLICY_FILE);
  const bytes = jsonBytes(policy);
  if (existsSync(file) && readFileSync(file, "utf8") === bytes) return { exitCode: 0, root, message: `seat: ${SEAT_POLICY_FILE} already records this policy; nothing written` };
  replaceFile(file, bytes);
  return { exitCode: 0, root, message: `seat: wrote ${SEAT_POLICY_FILE} (${policy.humanOnly ? "human only" : Object.entries(models).map(([tier, id]) => `${tier}=${id}`).join(", ")})` };
}
const titleOf = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/** Producer ia.json with `step` placed in its stage's group (`<round>.<stage>`), groups and rounds in pipeline order. */
export function placeSeat(ia: { schema: string; source: string; extensions: string[]; nodes: { id: string; label: string; children: { id: string; label: string; slots: string[] }[] }[] }, step: Step) {
  if (ia.nodes.some(node => node.children.some(child => child.slots.includes(step.id)))) return ia;
  const round = roundOf(step.stage), rounds: readonly string[] = ROUNDS.map(each => each.id);
  const nodes = ia.nodes.map(node => ({ ...node, children: node.children.map(child => ({ ...child, slots: [...child.slots] })) }));
  let node = nodes.find(each => each.id === round);
  if (!node) {
    node = { id: round, label: titleOf(round), children: [] };
    const at = nodes.findIndex(each => rounds.indexOf(each.id) > rounds.indexOf(round));
    nodes.splice(at < 0 ? nodes.length : at, 0, node);
  }
  let child = node.children.find(each => each.id === step.stage);
  if (!child) {
    child = { id: step.stage, label: titleOf(stageName(step.stage)), slots: [] };
    const at = node.children.findIndex(each => STAGES.indexOf(each.id as never) > STAGES.indexOf(step.stage));
    node.children.splice(at < 0 ? node.children.length : at, 0, child);
  }
  child.slots.push(step.id);
  return { ...ia, nodes };
}

export async function runSeatCli(argv: readonly string[], cwd: string, steps: readonly Step[] = STEPS): Promise<CliResult> {
  const flags = parseSeat(argv);
  if (flags.help) return { exitCode: 0, message: SEAT_USAGE };
  if (flags.bare.has("--policy")) return runSeatPolicy(flags, cwd);
  if (flags.bare.has("--human-only")) throw new CliUsageError(`--human-only is for seat --policy\n${SEAT_USAGE}`);
  const [id, ...extra] = flags.positional;
  if (!id || extra.length) throw new CliUsageError(`seat takes one <step>\n${SEAT_USAGE}`);
  const step = steps.find(each => each.id === id);
  if (!step || !isDecide(step)) return refuse("seat", `${id} is not a decide step`);
  const noLlm = flags.bare.has("--no-llm");
  const llmFrom = one(flags, "--llm-from");
  const llmFlags = ["--model", "--tier", "--prompt-file", "--llm-from"].filter(flag => flags.values.has(flag));
  if (noLlm && llmFlags.length) throw new CliUsageError(`--no-llm takes no ${llmFlags.join(", ")}\n${SEAT_USAGE}`);
  if (llmFrom && (flags.values.has("--model") || flags.values.has("--tier"))) throw new CliUsageError(`--llm-from takes the model and tier from that seat; give no --model or --tier\n${SEAT_USAGE}`);
  if (!noLlm && !(flags.values.has("--prompt-file") && (llmFrom || flags.values.has("--model") && flags.values.has("--tier")))) throw new CliUsageError(`a seat's llm needs --model, --tier (or --llm-from) and --prompt-file (or --no-llm)\n${SEAT_USAGE}`);
  if (flags.values.has("--procedure") !== flags.values.has("--command")) throw new CliUsageError(`a seat's human part needs both --procedure and --command\n${SEAT_USAGE}`);
  let model = one(flags, "--model"), tier = one(flags, "--tier");
  if (model && /^<.*>$/.test(model)) return refuse("seat", `--model ${model} is a placeholder: give the model id your account policy maps to the tier`);
  if (llmFrom) {
    const from = steps.find(each => each.id === llmFrom);
    const fromSeat = from ? readSeat(rootOf(cwd, flags), from) : null;
    if (!fromSeat || !fromSeat.llm || fromSeat.llm === "open") return refuse("seat", `--llm-from ${llmFrom}: that seat has no assigned llm yet; record it first`);
    model = fromSeat.llm.model; tier = fromSeat.llm.tier;
  }
  const seat = {
    by: need(flags, "--by", SEAT_USAGE),
    llm: noLlm ? null : { model: model!, tier: tier!, promptFile: one(flags, "--prompt-file")! },
    human: flags.values.has("--procedure") ? { procedure: one(flags, "--procedure")!, command: one(flags, "--command")! } : null,
  };
  const issues = validateValue(seat, loadSchema("seat"));
  if (issues.length) return refuse("seat", issues.map(issue => `${issue.path} ${issue.message}`).join("; "));
  const root = rootOf(cwd, flags), consumer = join(root, "clossys");
  // A pick seat's llm is its agent's make-step llm (seats.ts llmSourceOf; check:pipeline fails a mismatch).
  const source = /^pick\.(.+)$/.exec(id)?.[1];
  const sourceStep = source ? steps.find(each => each.id === `${source}.candidates`) : undefined;
  const sourceSeat = sourceStep ? readSeat(root, sourceStep) : null;
  if (seat.llm && sourceSeat && sourceSeat.llm && sourceSeat.llm !== "open" && (sourceSeat.llm.model !== seat.llm.model || sourceSeat.llm.tier !== seat.llm.tier)) return refuse("seat", `${id} picks with ${source}.candidates' llm (${sourceSeat.llm.model}, ${sourceSeat.llm.tier})`);
  const decidedBy = one(flags, "--decided-by") ?? "owner";
  if (!/^(owner|planner)(:\S.*)?$/.test(decidedBy)) throw new CliUsageError(`--decided-by must be owner[:<ref>] or planner[:<ref>]\n${SEAT_USAGE}`);
  const at = one(flags, "--at") ?? new Date().toISOString();
  const dir = seatDir(consumer, id);
  const existing = existsSync(candidatesDir(dir)) ? readdirSync(candidatesDir(dir)).map(name => CANDIDATE_NAME.exec(name)).filter(match => match?.[1] === id).map(match => Number(match![2])) : [];
  const name = `${id}-v${Math.max(0, ...existing) + 1}.json`;
  const bytes = jsonBytes(seat);
  const pin = { candidate: name, sha256: sha(bytes), decidedBy, basis: decidedBy.startsWith("planner") ? "planner" : "picked", at };
  const pinIssues = validatePin(pin);
  if (pinIssues.length) return refuse("seat", pinIssues.map(issue => issue.message).join("; "));
  const iaFile = iaPath(consumer, "producer");
  const ia = existsSync(iaFile) ? readJsonFile(iaFile) as Parameters<typeof placeSeat>[0] : { schema: IA_SCHEMA, source: "@clossys/producer#src/pipeline/steps", extensions: [], nodes: [] };
  const placed = placeSeat(ia, step);
  const candidate = join(candidatesDir(dir), name);
  const added = guarded(consumer, [iaFile, candidate, pinFile(dir)], () => {
    if (placed !== ia) replaceFile(iaFile, jsonBytes(placed));
    mkdirSync(candidatesDir(dir), { recursive: true });
    writeFileSync(candidate, bytes, { flag: "wx" });
    replaceFile(pinFile(dir), jsonBytes(pin));
  });
  if (added.length) return refuse("seat", `the slot model check fails after the write: ${added.slice(0, 5).join("; ")}`);
  const state = readSeat(root, step);
  return { exitCode: 0, root, message: `seat: ${id} is ${state?.state ?? "unread"} (by ${seat.by}${seat.llm ? `, llm ${seat.llm.model} ${seat.llm.tier}` : ", no llm"}${seat.human ? `, human ${seat.human.command}` : ""}); pinned ${name}` };
}

// ---------------------------------------------------------------- clossys rule
const parseRule = parser(RULE_USAGE, ["--quote", "--date", "--status", "--check", "--fixture", "--fixture-run", "--note", "--root"], ["--init", "--replace"]);
const RULE_ID = /^R-[A-Z0-9-]+$/;
const RULE_STATUSES = ["enforced", "unenforced", "pending-wire"] as const;
export const RULES_FILE = "scripts/rules/registry.json";

export async function runRuleCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parseRule(argv);
  if (flags.help) return { exitCode: 0, message: RULE_USAGE };
  const root = rootOf(cwd, flags);
  const file = join(root, ...RULES_FILE.split("/"));
  const empty = { schema: "foundry.rule-registry/1", about: "Owner rules as code: each rule names the checks that enforce it and a violation fixture each check must fail on.", rules: [], exemptions: [] };
  if (flags.bare.has("--init")) {
    if (flags.positional.length) throw new CliUsageError(`rule --init takes no rule id\n${RULE_USAGE}`);
    if (existsSync(file)) return { exitCode: 0, root, message: `rule: ${RULES_FILE} exists; nothing written` };
    replaceFile(file, jsonBytes(empty));
    return { exitCode: 0, root, message: `rule: wrote an empty ${RULES_FILE}` };
  }
  const [id, ...extra] = flags.positional;
  if (!id || extra.length) throw new CliUsageError(`rule takes one <R-ID>\n${RULE_USAGE}`);
  if (!RULE_ID.test(id)) return refuse("rule", `${id} is not a rule id (R-UPPER-CASE)`);
  const quote = need(flags, "--quote", RULE_USAGE), date = need(flags, "--date", RULE_USAGE), status = need(flags, "--status", RULE_USAGE);
  if (quote.length > 200 || /[\r\n]/.test(quote)) return refuse("rule", "--quote is the owner's words on one line, at most 200 characters");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return refuse("rule", "--date must be YYYY-MM-DD");
  if (!(RULE_STATUSES as readonly string[]).includes(status)) return refuse("rule", `--status must be ${RULE_STATUSES.join(", ")}`);
  const checks = flags.values.get("--check") ?? [], fixture = one(flags, "--fixture"), runs = flags.values.get("--fixture-run") ?? [];
  if (status === "enforced" && (!checks.length || !fixture || !runs.length)) return refuse("rule", "an enforced rule names its --check(s), its violation --fixture and the --fixture-run command(s) that fail on it");
  // The first rule the owner states starts the registry (the same empty one rule --init writes).
  const registry = (existsSync(file) ? readJsonFile(file) : empty) as { rules: { id: string }[] } & Record<string, unknown>;
  const row: Record<string, unknown> = {
    id, owner_words: { quote, date }, status,
    ...(checks.length ? { checks } : {}), ...(fixture ? { fixture } : {}), ...(runs.length ? { fixture_runs: runs } : {}),
    ...(one(flags, "--note") ? { note: one(flags, "--note") } : {}),
  };
  const at = registry.rules.findIndex(rule => rule.id === id);
  if (at >= 0 && !flags.bare.has("--replace")) return refuse("rule", `${id} exists; --replace replaces its row`);
  const rules = [...registry.rules];
  if (at >= 0) rules[at] = row as { id: string }; else rules.push(row as { id: string });
  const next = { ...registry, rules };
  const issues = validateValue(next, loadSchema("rule-registry"));
  if (issues.length) return refuse("rule", issues.map(issue => `${issue.path} ${issue.message}`).join("; "));
  replaceFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return { exitCode: 0, root, message: `rule: ${at >= 0 ? "replaced" : "added"} ${id} (${status}) in ${RULES_FILE}` };
}

// ---------------------------------------------------------------- clossys approve
const parseApprove = parser(APPROVE_USAGE, ["--by", "--at", "--root"], []);

export async function runApproveCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parseApprove(argv);
  if (flags.help) return { exitCode: 0, message: APPROVE_USAGE };
  const [target, candidateId, ...extra] = flags.positional;
  if (!target || !candidateId || extra.length) throw new CliUsageError(`approve takes writer/<slot> and a candidate id\n${APPROVE_USAGE}`);
  if (!target.startsWith("writer/")) return refuse("approve", `approve is the owner's Writer copy approval; ${target} is not a Writer slot`);
  const slot = target.slice("writer/".length);
  const by = one(flags, "--by") ?? "owner";
  // Approval is the owner's: an agent pick (clossys pick) or a planner pin is not editorial approval.
  if (!/^owner(:\S.*)?$/.test(by)) return refuse("approve", `--by ${by}: only the owner approves Writer copy`);
  const at = one(flags, "--at") ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) throw new CliUsageError(`--at must be an ISO timestamp\n${APPROVE_USAGE}`);
  const root = rootOf(cwd, flags), consumer = join(root, "clossys");
  const entry = readSlotEntry(consumer, "writer", slot);
  if (!entry) return refuse("approve", `unknown slot ${target} (not in writer ia.json)`);
  const candidate = resolveCandidate(entry.candidates, candidateId);
  if (!candidate) return refuse("approve", `${target} has no candidate ${candidateId}`);
  const before = writerKeysUnapproved(root).get(slot) ?? [];
  const dir = slotDir(consumer, "writer", slot);
  let pinned: { candidate: string; sha256: string } | undefined;
  let added: string[];
  try { added = guarded(consumer, [pinFile(dir), slotFile(dir)], () => { pinned = writePin(consumer, "writer", slot, candidate, { decidedBy: by, basis: "picked", at }); }); }
  catch (error) { return refuse("approve", error instanceof Error ? error.message : String(error)); }
  if (added.length) return refuse("approve", `the slot model check fails after the write: ${added.slice(0, 5).join("; ")}`);
  const after = new Set(writerKeysUnapproved(root).get(slot) ?? []);
  const approved = before.filter(key => !after.has(key));
  return { exitCode: 0, root, decision: { slot: target, state: "pinned", ...pinned, decidedBy: by, basis: "picked", at, approved }, message: `approve: ${target} ${candidate} pinned by ${by} (picked); ${approved.length} key${approved.length === 1 ? "" : "s"} approved${after.size ? `, ${after.size} still open` : ""}` };
}
