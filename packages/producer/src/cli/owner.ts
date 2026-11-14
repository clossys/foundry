/**
 * The owner verbs: each records one owner decision step (W6a; they replace the six gaps).
 *
 *   clossys ia <agent>/<slot> --contract <file> [--standard <id>] [--under <l1>/<l2>] [--kind <kind>] [--inputs <id,...>] [--uses <id,...>] [--owner-ref <ref>] [--dry] [--root <dir>]
 *   clossys ia <agent>/<slot> --standard <id> [--owner-ref <ref>] [--dry] [--root <dir>]
 *   clossys ia producer/<seat> --standard <id> [--contract <file>] [--owner-ref <ref>] [--dry] [--root <dir>]
 *   clossys ia <agent>/<slot> --remove [--owner-ref <ref>] [--dry] [--root <dir>]
 *   clossys ia <agent>/<slot> --move --under <l1>/<l2>|<l0>/<l1>/<l2> [--extension true|false] --owner-ref <ref> [--at <iso>] [--dry] [--root <dir>]
 *   clossys ia <agent>/<slot> --extension true|false --owner-ref <ref> [--at <iso>] [--dry] [--root <dir>]
 *   clossys ia <agent> --add|--rename|--merge|--drop|--reorder|--assign|--layers|--axes ... --owner-ref <ref> [--at <iso>] [--dry] [--root <dir>]  (IA_USAGE; cli/ia-regroup.ts)
 *   clossys evidence <id> --source <source> --observed <YYYY-MM-DD> --by <who> --body <file> [--finding] [--root <dir>]
 *   clossys config --init [--from <file>] [--root <dir>]
 *   clossys seat <step> --by <who> (--model <id> --tier low|mid|high --prompt-file <path> | --no-llm) [--procedure <text> --command <verb>] [--decided-by owner|planner] [--root <dir>]
 *   clossys rule --init [--root <dir>]
 *   clossys rule <R-ID> --quote <text> --date <YYYY-MM-DD> --status enforced|unenforced|pending-wire [--check <id>]... [--fixture <path>] [--fixture-run <cmd>]... [--note <text>] [--replace] [--root <dir>]
 *   clossys approve writer/<slot> <candidate-id> [--by owner[:<ref>]] [--at <iso>] [--root <dir>]
 *   clossys owner-decision add --ref <ledger ref> --scope <op,...> --quote-file <file> [--date <YYYY-MM-DD>] [--root <dir>]
 *   clossys owner-decision init [--root <dir>]
 *   clossys retire <agent>/<slot> <candidate> --by <who> --reason <code>[: <note>] [--at <iso>] [--root <dir>]
 *   clossys retire <agent>/<slot> --slot --by <who> --reason <code>[: <note>] [--at <iso>] [--root <dir>]
 *
 * Every write is validated against its schema and the slot model check: a write that adds a slot
 * model issue is rolled back and refused (exit 1). A refusal is recorded like any run (exit 1).
 * Slot-model reads go through the one reader (records/slots.ts); see check:single-reader.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { packagePath } from "../package-path.js";
import { checkSlotModel, RETIRED_DIR } from "../records/slot-check.js";
import { ledgerComment, OWNER_DECISION_SCOPES, OWNER_DECISIONS_FILE, OWNER_DECISIONS_SCHEMA, resolveOwnerRef, validateOwnerDecisions, type OwnerDecision } from "../records/owner-decisions.js";
import { AGENT_KIND, CANDIDATE_NAME, OWNER_WORDS_REF_FORM, FOUNDRY_IA_AFTER, FOUNDRY_IA_AGENTS, IA_SCHEMA, SEAT_AGENT, SLOT_AGENTS, SLOT_ID, SLOT_KINDS, SLOT_SCHEMA, STANDARD_ID, seatSlotId, seatStepOf } from "../records/slot-model/types.js";
import type { IaDoc, SlotAgent, SlotKind } from "../records/slot-model/types.js";
import { agentDir, candidatesDir, iaPath, jsonBytes, pinFile, seatDir, slotDir, slotFile } from "../records/slot-model/layout.js";
import { designerIa, directorIa, slotPositions, writerIa, type FoundryIa } from "../records/slot-model/foundry-ia.js";
import { deriveRefs, feedsIndex } from "../records/slot-model/derive.js";
import { driftCounts, SYNC_AGENTS, syncDrift, type SyncAgent, type SyncFinding } from "../records/slot-model/ia-sync.js";
import { validateIa, validatePin, validateSlotDoc } from "../records/slot-model/validate.js";
import { isModelDir, listModelDir, listSlots, modelExists, readModelBytes, readModelText, readSlot, readSlotEntry, readSlotRecordText, usedBy, withModelOverlay } from "../records/slots.js";
import { RETIRE_SCHEMA, appendIaEvent, appendRetireCandidate, appendRetireSlot, appendSlotDocEvent, createModelFile, dropEmptyModelDir, moveModelEntry, removeModelFile, replaceModelFile, writePin } from "../records/slot-write.js";
import { LEDGER_FILE, skillPath } from "../records/ledger.js";
import { readStandard, slotKinds, standardFits } from "../records/standards.js";
import type { ModelAgent } from "../records/slot-model/index.js";
import { isDecide, roundOf, ROUNDS, STAGES } from "../pipeline/define.js";
import type { Step } from "../pipeline/define.js";
import { loadSchema, validateFile, validateValue } from "../pipeline/schema.js";
import { readSeat } from "../pipeline/seats.js";
import { SEAT_POLICY_FILE, SEAT_POLICY_SCHEMA, validateSeatPolicy } from "../pipeline/seat-policy.js";
import { writerKeysUnapproved } from "../pipeline/status.js";
import { STEPS } from "../pipeline/steps/index.js";
import { RETIRE_CODES, RETIRE_REASON } from "../constitution/checks/R10-retire.js";
import { validateAgainst } from "../constitution/schema.js";
import { IA_KIND, slotWriteKind } from "../constitution/green.js";
import { resolveCandidate } from "./pin.js";
import { CliUsageError } from "./args.js";
import { addGroup, assignGroup, dropGroup, followPositions, mergeGroups, moveSlot, planIaWrite, renameGroup, reorderGroup, setAxes, setExtension, setLayers, type Edit, type IaFile, type PositionFollow } from "./ia-regroup.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";
import { RULES_FILE } from "./rules-file.js";

export const IA_USAGE = "Usage: clossys ia <agent>/<slot> --contract <file> [--standard <id>] [--under <l1>/<l2>] [--kind <kind>] [--inputs <id,...>] [--uses <id,...>] [--owner-ref <ref>] [--dry] [--root <dir>]\n"
  + "       clossys ia <agent>/<slot> --standard <id> [--owner-ref <ref>] [--dry] [--root <dir>]\n"
  + "       clossys ia producer/<seat> --standard <id> [--contract <file>] [--owner-ref <ref>] [--dry] [--root <dir>]\n"
  + "       clossys ia producer/<seat> --move --under <l1>/<l2> --owner-ref <ref> [--dry] [--root <dir>]  (a placed seat; a new seat is placed by clossys seat <step>)\n"
  + "       clossys ia <agent>/<slot> --remove [--owner-ref <ref>] [--dry] [--root <dir>]\n"
  + "       clossys ia <agent> --adopt | --start [--dry] [--root <dir>]\n"
  + "       clossys ia sync [--check] [--agent <agent>] [--dry] [--root <dir>]\n"
  + "  places a slot in its agent's ia.json (--under, when it is not placed yet) and writes its slot.json with the contract (a JSON object file).\n"
  + "  --standard names the standard the slot is judged by (packages/<agent>/standards/<id>/, R15.1): it must exist, be valid and serve the slot's kind; alone it keeps the written contract.\n"
  + "  producer/<seat>: names the standard of a seat slot clossys seat wrote (kind seat); --contract may add requirements but keeps the seat's step. Nothing else of a seat is written here.\n"
  + "  --adopt writes the agent's Foundry IA (ia.json and every slot.json, inputs and uses derived) where it has no ia.json (Director, Designer, Writer; the Director's first).\n"
  + "  --start writes an empty workspace IA instead; --under then adds its L1/L2 groups as it places each slot.\n"
  + "  sync refreshes ia.json and every slot.json structure field from the package IA the consumer resolves (declared extensions kept; candidates, pins and ledgers untouched); --check lists the drift and exits 1 on any.\n"
  + "Regroup (owner-authorized; leaf ids never change, only placement; every slot.json position follows in the same guarded write):\n"
  + "       clossys ia <agent>/<slot> --move --under <l1>/<l2>|<l0>/<l1>/<l2> [--extension true|false] --owner-ref <ref>\n"
  + "       clossys ia <agent>/<slot> --extension true|false --owner-ref <ref>\n"
  + "       clossys ia <agent> --add <l1>|<l1>/<l2> --label <text> [--layer <l0>] --owner-ref <ref>\n"
  + "       clossys ia <agent> --rename <l0>|<l1>|<l1>/<l2> [--label <text>] [--id <new id>] --owner-ref <ref>\n"
  + "       clossys ia <agent> --merge <l0>|<l1>|<l1>/<l2> --into <same level> --owner-ref <ref>\n"
  + "       clossys ia <agent> --drop <l0>|<l1>|<l1>/<l2> --owner-ref <ref>\n"
  + "       clossys ia <agent> --reorder L0|<l0>|<l1>|<l1>/<l2> --order <id,...> --owner-ref <ref>\n"
  + "       clossys ia <agent> --assign <l1> --layer <l0> [--label <text>] --owner-ref <ref>\n"
  + "       clossys ia <agent> --layers <file> | --axes <file> --owner-ref <ref>\n"
  + "  each also takes [--at <iso>] [--dry] [--root <dir>].\n"
  + "  --move: an already placed slot to the end of another L2 group (<l0>/ checks the group's L0).\n"
  + "  --extension: the slot is (true) or is no longer (false) a signed extension, in slot.json and the ia.json extensions list alike.\n"
  + "  --add: a new, empty tab (L1) or group (L2); --rename: the label, and the id only with --id (layer refs and axes follow).\n"
  + "  --merge: one tab, group or layer into another of its level; --drop: removes one only when it holds no leaf.\n"
  + "  --reorder: the members of one parent (L0 = the layers), --order an exact permutation.\n"
  + "  --assign: a whole L1 into an L0 layer (--label creates the layer); --layers: the L0 layers (a JSON list of { id, label, nodes });\n"
  + "  --axes: the L0/L1 vocabularies (ia.schema.json axes). Once axes are declared the layers are the L0: slot.json ia.l0 follows.\n"
  + "  --owner-ref: the ledger comment id (or ledger ref) of the owner's words, a decision registered in clossys/owner-decisions.json;\n"
  + "  resolved offline (never GitHub), refused when unknown, and recorded in ia.json changes[] with every write it allows.\n"
  + "  --dry prints the planned change and the files it would write, and writes nothing.";
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
export const OWNER_DECISION_USAGE = "Usage: clossys owner-decision add --ref <ledger ref> --scope <op,...> --quote-file <file> [--date <YYYY-MM-DD>] [--root <dir>]\n"
  + "       clossys owner-decision init [--root <dir>]\n"
  + "  registers one owner decision in clossys/owner-decisions.json (the registry --owner-ref resolves against), starting the file when it has none.\n"
  + `  --ref: the ledger comment that holds the owner's words (${OWNER_WORDS_REF_FORM}, an optional (note) after it); its comment id is the decision id;\n`
  + `  --scope: what the decision authorizes, one or more of ${OWNER_DECISION_SCOPES.join(", ")};\n`
  + "  --quote-file: a file holding the owner's words (or their summary) on one line, the decision's summary;\n"
  + "  --date: the date of the owner's words (default today, UTC). A registered id is never rewritten.";
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

/** Write by renaming a fully written sibling over the target (records/slot-write.ts, the one writer). */
const replaceFile = replaceModelFile;
/** The files a write touches, as they were, so a refused write is undone byte for byte. */
function snapshot(paths: readonly string[]): () => void {
  const before = paths.map(path => ({ path, bytes: modelExists(path) ? readModelBytes(path) : null }));
  return () => { for (const entry of before) { if (entry.bytes === null) removeModelFile(entry.path); else replaceModelFile(entry.path, entry.bytes); } };
}
interface ModelIssue { code: string; path: string; message: string }
const issueKey = (issue: ModelIssue) => `${issue.code} ${issue.path} ${issue.message}`;
const modelIssues = (consumer: string) => checkSlotModel(consumer).map(issueKey);
/** The slot model issues `writes` would add, judged in memory (the reader's overlay): what `guarded` would undo, with nothing written. */
function plannedIssues(consumer: string, writes: readonly (readonly [string, string])[]): string[] {
  const before = new Set(modelIssues(consumer));
  return withModelOverlay(writes, () => modelIssues(consumer)).filter(issue => !before.has(issue));
}
/**
 * Runs `write`; when the slot model check then has an issue it did not have before, undoes it and returns the issues.
 * `undo` reverses what the file snapshot cannot (a moved folder).
 */
function guarded(consumer: string, paths: readonly string[], write: () => void, options: { undo?: () => void } = {}): string[] {
  const issues = () => modelIssues(consumer);
  const before = new Set(issues());
  const files = snapshot(paths);
  const undo = () => { options.undo?.(); files(); };
  try { write(); } catch (error) { undo(); throw error; }
  const added = issues().filter(issue => !before.has(issue));
  if (added.length) undo();
  return added;
}
/** A JSON file the caller names (a --contract file); never a slot-model path. */
const readJsonFile = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
/** A slot-model JSON file, read through the one reader. */
const readModelJson = (path: string): unknown => JSON.parse(readModelText(path));

// ---------------------------------------------------------------- clossys ia
const parseIa = parser(IA_USAGE, [
  "--contract", "--standard", "--under", "--kind", "--inputs", "--uses", "--root", "--owner-ref", "--at", "--extension",
  "--add", "--rename", "--merge", "--into", "--drop", "--reorder", "--order", "--assign", "--layer", "--label", "--id", "--layers", "--axes", "--agent",
], ["--remove", "--adopt", "--start", "--move", "--dry", "--check"]);
const FOUNDRY_IA: Readonly<Record<keyof typeof FOUNDRY_IA_AFTER, () => FoundryIa>> = { director: directorIa, designer: designerIa, writer: writerIa };
/** The source of a workspace-owned IA (`--start`): `--under` may add L1/L2 groups to it, never to a Foundry IA. */
export const WORKSPACE_IA_SOURCE = "workspace#owner";
/** The agent-level regroup operations and the flags each takes besides --owner-ref, --at and --root. */
const REGROUP_OPS: Readonly<Record<string, readonly string[]>> = {
  "--add": ["--label", "--layer"], "--rename": ["--label", "--id"], "--merge": ["--into"], "--drop": [],
  "--reorder": ["--order"], "--assign": ["--layer", "--label"], "--layers": [], "--axes": [],
};
const GATE_FLAGS = ["--owner-ref", "--at", "--root"];

/**
 * Apply one ia write list through the guarded writer, or under `--dry` print it and write nothing.
 * A dry run validates what a write validates and runs the same slot model check on the planned files in
 * memory: it refuses (exit 1) exactly where the write would be refused, and lists the files either way.
 */
function commitIa(consumer: string, root: string, writes: readonly (readonly [string, string])[], dry: boolean, summary: string, lines: readonly string[] = [], message = `ia: ${summary}`, who: IaWho = {}): CliResult {
  const rel = (path: string) => relative(root, path).split(sep).join("/");
  if (dry) {
    const files = writes.map(([path]) => rel(path));
    const shown = files.length > 25 ? [...files.slice(0, 25), `... and ${files.length - 25} more`] : files;
    const listed = [...lines.map(line => `  ${line}`), ...shown.map(file => `  write ${file}`)];
    const added = plannedIssues(consumer, writes);
    if (added.length) return {
      exitCode: 1, root, output: { dry: true, refused: true, summary, changes: lines, writes: files, issues: added },
      message: [`ia --dry refused: the slot model check would fail after the write: ${added.slice(0, 5).join("; ")}${added.length > 5 ? ` (and ${added.length - 5} more)` : ""}`, `  ${summary}; would write ${files.length} file${files.length === 1 ? "" : "s"}, wrote nothing`, ...listed].join("\n"),
    };
    return {
      exitCode: 0, root, output: { dry: true, summary, changes: lines, writes: files },
      message: [`ia --dry: ${summary}; would write ${files.length} file${files.length === 1 ? "" : "s"}, wrote nothing`, ...listed].join("\n"),
    };
  }
  // One ledger event per written file (R14.1), appended after every file is written; a refused write restores each ledger.
  const targets = writes.map(([path, bytes]) => iaWriteTarget(consumer, path, bytes));
  const ledgers = [...new Set(writes.map(([path]) => join(dirname(path), LEDGER_FILE)))];
  const by = who.by ?? "planner", at = who.at || new Date().toISOString();
  const added = guarded(consumer, [...writes.map(([path]) => path), ...ledgers], () => {
    for (const [path, bytes] of writes) replaceFile(path, bytes);
    for (const target of targets) {
      if (target.slot === undefined) appendIaEvent(consumer, target.agent, { by, at, fields: { kind: target.kind } });
      else appendSlotDocEvent(consumer, target.agent, target.slot, { by, at, verb: "ia", skill: skillPath("producer", "ia"), fields: { kind: target.kind } });
    }
  });
  if (added.length) return refuse("ia", `the slot model check fails after the write: ${added.slice(0, 5).join("; ")}`);
  return { exitCode: 0, root, message: [message, ...lines.map(line => `  ${line}`)].join("\n") };
}
/** Who an `ia` write's ledger events name: `owner` with an owner ref, else `planner`; `at` defaults to now. */
interface IaWho { readonly by?: string; readonly at?: string }
const iaWho = (ownerRef: string | undefined, at: string): IaWho => ({ by: ownerRef ? "owner" : "planner", at });
/**
 * The ledger an `ia` write goes to and its event kind: ia.json → the agent ledger, kind `ia`;
 * `<agent>/<slot>/slot.json` → the slot ledger, kind `ia-position` when only the position fields
 * changed (green.ts slotWriteKind, the record digest's own view), else `ia`.
 */
function iaWriteTarget(consumer: string, path: string, bytes: string): { agent: ModelAgent; slot?: string; kind: string } {
  const parts = relative(join(consumer, "agents"), path).split(sep);
  const agent = parts[0] as ModelAgent;
  if (!(SLOT_AGENTS as readonly string[]).includes(agent) && (agent as string) !== SEAT_AGENT) throw new Error(`ia write outside an agent tree: ${path}`);
  if (parts.length === 2 && parts[1] === "ia.json") return { agent, kind: IA_KIND };
  if (parts.length === 3 && parts[2] === "slot.json") return { agent, slot: parts[1]!, kind: slotWriteKind(modelExists(path) ? readModelText(path) : null, bytes) };
  throw new Error(`ia write is neither an ia.json nor a slot.json: ${path}`);
}
/** `--owner-ref`, resolved against clossys/owner-decisions.json (offline): the ref to record, or the refusal. */
function ownerRefOf(flags: Flags, consumer: string, required: boolean): { ref?: string } | CliResult {
  const given = one(flags, "--owner-ref");
  if (given === undefined && !required) return {};
  const resolved = resolveOwnerRef(consumer, given, "ia");
  return "error" in resolved ? refuse("ia", resolved.error) : { ref: resolved.decision.ref };
}
const isResult = (value: object): value is CliResult => "exitCode" in value;
function atOf(flags: Flags): string {
  const at = one(flags, "--at") ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) throw new CliUsageError(`--at must be an ISO timestamp\n${IA_USAGE}`);
  return at;
}
/** An edit, planned (slot.json positions follow, the owner ref recorded) and committed, or printed under --dry. */
function applyEdit(consumer: string, root: string, agent: ModelAgent, ia: IaFile, edit: Edit, op: string, ownerRef: string, at: string, dry: boolean): CliResult {
  if ("error" in edit) return refuse("ia", edit.error);
  if ("unchanged" in edit) return { exitCode: 0, root, message: `ia: ${edit.unchanged}; nothing written` };
  const plan = planIaWrite(consumer, agent, ia, edit, { op, ownerRef, at });
  if ("error" in plan) return refuse("ia", plan.error);
  if ("unchanged" in plan) return { exitCode: 0, root, message: `ia: ${plan.unchanged}; nothing written` };
  return commitIa(consumer, root, plan.writes, dry, `${agent} ${edit.detail}`, plan.lines, undefined, iaWho(ownerRef, at));
}

/** `clossys ia <agent> --start`: an empty workspace-owned ia.json, where the agent has none. */
function startIa(agent: string, root: string, dry: boolean): CliResult {
  if (!(SLOT_AGENTS as readonly string[]).includes(agent)) throw new CliUsageError(`ia --start takes one of ${SLOT_AGENTS.join(", ")}\n${IA_USAGE}`);
  const consumer = join(root, "clossys"), iaFile = iaPath(consumer, agent as SlotAgent);
  if (modelExists(iaFile)) return refuse("ia", `${agent} ia.json exists; change it slot by slot (--under, --remove)`);
  const doc = { schema: IA_SCHEMA, source: WORKSPACE_IA_SOURCE, extensions: [], nodes: [] };
  return commitIa(consumer, root, [[iaFile, jsonBytes(doc)]], dry, `started an empty ${agent} IA`, [],
    `ia: started an empty ${agent} IA (clossys/agents/${agent}/ia.json); place each slot with clossys ia ${agent}/<slot> --under <l1>/<l2> --contract <file>`);
}

/** `clossys ia <agent> --adopt`: the agent's Foundry IA and every slot.json, written only where the agent has no ia.json. */
function adoptIa(agent: string, root: string, dry: boolean): CliResult {
  if (!(FOUNDRY_IA_AGENTS as readonly string[]).includes(agent)) throw new CliUsageError(`ia --adopt takes ${FOUNDRY_IA_AGENTS.join(", ")}; the Publisher IA is the workspace's own (ia publisher --start)\n${IA_USAGE}`);
  const read = FOUNDRY_IA[agent as keyof typeof FOUNDRY_IA], after = FOUNDRY_IA_AFTER[agent as keyof typeof FOUNDRY_IA];
  const consumer = join(root, "clossys"), iaFile = iaPath(consumer, agent as SlotAgent);
  if (modelExists(iaFile)) return refuse("ia", `${agent} ia.json exists; change it slot by slot (--under, --remove)`);
  const first = after.filter(up => !modelExists(iaPath(consumer, up)));
  if (first.length) return refuse("ia", `adopt the ${first.join(", ")} IA first: ${agent} slots read its slots`);
  const foundry = read();
  // Refs resolve against the slots this workspace places, plus the adopted ones; the Director's feeds become downstream inputs.
  const known = new Set(foundry.slots.keys());
  for (const other of SLOT_AGENTS) if (other !== agent && modelExists(iaPath(consumer, other))) {
    for (const id of slotPositions(other, readModelJson(iaPath(consumer, other)) as IaDoc).keys()) known.add(id);
  }
  const feeds = feedsIndex([...(agent === "director" ? foundry : directorIa()).slots.values()].map(slot => [slot.id, slot.feeds] as const), known);
  const writes: [string, string][] = [[iaFile, jsonBytes(foundry.ia)]];
  let dropped = 0;
  for (const [id, position] of slotPositions(agent as SlotAgent, foundry.ia)) {
    const slot = foundry.slots.get(id)!, file = slotFile(slotDir(consumer, agent as SlotAgent, id));
    if (modelExists(file)) return refuse("ia", `clossys/agents/${agent}/${id}/slot.json exists with no ${agent} ia.json; place it with --under or remove it first`);
    const derived = deriveRefs(agent as SlotAgent, slot.kind, id, { inputs: slot.declaredInputs, uses: slot.declaredUses }, { known, feeds });
    dropped += derived.dropped.length;
    const doc = { schema: SLOT_SCHEMA, id, agent, ia: { ...position }, kind: slot.kind, contract: slot.contract, inputs: derived.inputs, uses: derived.uses };
    const issues = validateSlotDoc(doc, file);
    if (issues.length) return refuse("ia", `${agent}/${id}: ${issues.map(issue => issue.message).join("; ")}`);
    writes.push([file, jsonBytes(doc)]);
  }
  const slots = writes.length - 1;
  return commitIa(consumer, root, writes, dry, `adopt the ${agent} IA from ${foundry.ia.source} (${foundry.ia.nodes.length} L1, ${slots} slots)`, [],
    `ia: adopted the ${agent} IA from ${foundry.ia.source} (${foundry.ia.nodes.length} L1, ${slots} slots with their contracts)${dropped ? `; ${dropped} declared refs name no placed slot and were left out` : ""}`);
}
const ids = (value: string | undefined) => value ? value.split(",").map(id => id.trim()).filter(Boolean) : [];
type AgentIaFile = { extensions?: string[]; nodes: { id: string; label: string; children: { id: string; label: string; slots: string[] }[] }[] } & Record<string, unknown>;
const isPlaced = (ia: AgentIaFile, slot: string) => ia.nodes.some(node => node.children.some(child => child.slots.includes(slot)));
/** The agent IA with `slot` taken out of its group and its extensions (ia --remove, retire --slot). */
const withoutSlot = (ia: AgentIaFile, slot: string): AgentIaFile => ({ ...ia, nodes: ia.nodes.map(node => ({ ...node, children: node.children.map(child => ({ ...child, slots: child.slots.filter(id => id !== slot) })) })), extensions: (ia.extensions ?? []).filter(id => id !== slot) });
/** The renumbered slot.json files of a placement or removal, for its change record and its output lines. */
const renumbered = (follow: PositionFollow) => follow.writes.length ? `; ${follow.writes.length} later slot.json renumbered (order only)` : "";
const followLines = (follow: PositionFollow) => [...follow.moved, ...(follow.reordered ? [`${follow.reordered} other slot.json renumbered (order only)`] : [])];
/** ia.json with one owner-authorized change appended (the record every gated write carries). */
const withChange = (ia: AgentIaFile, change: { op: string; ownerRef: string; at: string; detail: string; slotFiles: number }): AgentIaFile =>
  ({ ...ia, changes: [...(Array.isArray(ia.changes) ? ia.changes : []), change] });

/**
 * `clossys ia <agent> --add|--rename|--merge|--drop|--reorder|--assign|--layers|--axes`: one owner-authorized
 * regroup of the agent IA. The Producer seat tree (producer ia.json) regroups the same way: its groups and
 * layers are the owner's, while a new seat is only ever placed by `clossys seat <step>`.
 */
const REGROUP_AGENTS: readonly ModelAgent[] = [...SLOT_AGENTS, SEAT_AGENT];
function runIaRegroup(flags: Flags, cwd: string, target: string, op: string): CliResult {
  if (target.includes("/") || !(REGROUP_AGENTS as readonly string[]).includes(target)) throw new CliUsageError(`ia ${op} takes one <agent> (${REGROUP_AGENTS.join(", ")}), got ${target}\n${IA_USAGE}`);
  const allowed = [op, ...REGROUP_OPS[op]!, ...GATE_FLAGS];
  const stray = [...[...flags.values.keys()].filter(flag => !allowed.includes(flag)), ...[...flags.bare].filter(flag => flag !== "--dry")];
  if (stray.length) throw new CliUsageError(`ia ${op} takes no ${stray.join(", ")}\n${IA_USAGE}`);
  const agent = target as ModelAgent;
  const root = rootOf(cwd, flags), consumer = join(root, "clossys"), iaFile = iaPath(consumer, agent);
  if (!modelExists(iaFile)) return refuse("ia", `${agent} has no ia.json${agent === SEAT_AGENT ? ": producer ia.json is written by clossys seat <step>" : ""}`);
  const owner = ownerRefOf(flags, consumer, true);
  if (isResult(owner)) return owner;
  const at = atOf(flags);
  const ia = readModelJson(iaFile) as IaFile;
  const value = one(flags, op)!;
  let edit: Edit;
  if (op === "--add") edit = addGroup(agent, ia, value, need(flags, "--label", IA_USAGE), one(flags, "--layer"));
  else if (op === "--rename") edit = renameGroup(ia, value, one(flags, "--label"), one(flags, "--id"));
  else if (op === "--merge") edit = mergeGroups(ia, value, need(flags, "--into", IA_USAGE));
  else if (op === "--drop") edit = dropGroup(ia, value);
  else if (op === "--reorder") edit = reorderGroup(agent, ia, value, ids(need(flags, "--order", IA_USAGE)));
  else if (op === "--assign") edit = assignGroup(ia, value, need(flags, "--layer", IA_USAGE), one(flags, "--label"));
  else {
    let parsed: unknown;
    try { parsed = readJsonFile(resolve(cwd, value)); } catch { return refuse("ia", `${op} ${value} is not a readable JSON file`); }
    edit = op === "--layers" ? setLayers(ia, parsed) : setAxes(ia, parsed);
  }
  return applyEdit(consumer, root, agent, ia, edit, op.slice(2), owner.ref!, at, flags.bare.has("--dry"));
}

/** `clossys ia <agent>/<slot> --move --under ... [--extension]` or `--extension true|false`: one placed slot, owner-authorized. */
function runIaSlotRegroup(flags: Flags, consumer: string, root: string, agent: ModelAgent, slot: string, ia: IaFile): CliResult {
  const move = flags.bare.has("--move"), given = one(flags, "--extension");
  const allowed = [...(move ? ["--under"] : []), "--extension", ...GATE_FLAGS];
  const stray = [...[...flags.values.keys()].filter(flag => !allowed.includes(flag)), ...[...flags.bare].filter(flag => flag !== "--dry" && flag !== "--move")];
  if (stray.length) throw new CliUsageError(`ia ${move ? "--move" : "--extension"} takes no ${stray.join(", ")}\n${IA_USAGE}`);
  if (given !== undefined && given !== "true" && given !== "false") throw new CliUsageError(`--extension takes true or false, got ${given}\n${IA_USAGE}`);
  if (!isPlaced(ia, slot)) return refuse("ia", `${agent}/${slot} is not placed in ${agent} ia.json; ${agent === SEAT_AGENT ? `a new seat is placed by clossys seat ${seatStepOf(slot) ?? "<step>"}` : "place it with --contract <file> --under"}`);
  const owner = ownerRefOf(flags, consumer, true);
  if (isResult(owner)) return owner;
  const at = atOf(flags);
  const extension = given === undefined ? undefined : given === "true";
  let edit: Edit = move ? moveSlot(agent, ia, slot, need(flags, "--under", IA_USAGE)) : setExtension(ia, slot, extension!);
  if (move && extension !== undefined && !("error" in edit)) {
    const flagged = setExtension("ia" in edit ? edit.ia : ia, slot, extension) as Extract<Edit, { ia: IaFile }>;
    edit = { ia: flagged.ia, detail: "ia" in edit ? `${edit.detail}; ${flagged.detail}` : flagged.detail, slot: { id: slot, extension } };
  }
  return applyEdit(consumer, root, agent, ia, edit, move ? "move" : "extension", owner.ref!, at, flags.bare.has("--dry"));
}

/**
 * `clossys ia producer/<seat> --standard <id> [--contract <file>]`: names the standard a seat slot is
 * judged by (R15.1). A seat's slot.json is written once by `clossys seat`; this only adds `standard`
 * and, with --contract, a contract that keeps the seat's step (its requirements, R15/R16). It never
 * places, moves or removes a seat.
 */
function runIaSeatStandard(flags: Flags, cwd: string, target: string, slot: string): CliResult {
  const allowed = new Set(["--standard", "--contract", "--root", "--owner-ref", "--at"]);
  const extra = [...flags.values.keys()].filter(flag => !allowed.has(flag));
  if (extra.length || [...flags.bare].some(flag => flag !== "--dry")) throw new CliUsageError(`ia ${target} takes only --standard, --contract, --owner-ref, --at, --dry and --root (a seat is placed by clossys seat)\n${IA_USAGE}`);
  const standardId = need(flags, "--standard", IA_USAGE);
  if (!STANDARD_ID.test(standardId)) throw new CliUsageError(`--standard must be a standard id such as element.button, got ${standardId}\n${IA_USAGE}`);
  const root = rootOf(cwd, flags), consumer = join(root, "clossys");
  const owner = ownerRefOf(flags, consumer, false);
  if (isResult(owner)) return owner;
  const eventAt = (owner.ref || flags.values.has("--at")) ? atOf(flags) : "";
  const dir = join(agentDir(consumer, SEAT_AGENT), slot);
  const file = slotFile(dir);
  if (!modelExists(file)) return refuse("ia", `${target} has no slot.json: a seat slot is written by clossys seat <step>`);
  const existing = readModelJson(file) as Record<string, unknown>;
  if (existing.kind !== "seat") return refuse("ia", `${target} is kind ${String(existing.kind)}, not seat`);
  const step = isRecordValue(existing.contract) ? existing.contract.step : undefined;
  let contract: unknown = existing.contract;
  const contractFile = one(flags, "--contract");
  if (contractFile !== undefined) {
    try { contract = readJsonFile(resolve(cwd, contractFile)); } catch { return refuse("ia", `--contract ${contractFile} is not a readable JSON file`); }
    if (!isRecordValue(contract) || contract.step !== step) return refuse("ia", `--contract must keep the seat's step ${JSON.stringify(step)}`);
  }
  if (!existsSync(packagePath(root, `packages/${SEAT_AGENT}/standards/${standardId}/requirements.json`))) return refuse("ia", `standard ${standardId} does not exist under packages/${SEAT_AGENT}/standards/`);
  const standard = readStandard(root, SEAT_AGENT, standardId);
  if (!standard.doc || standard.issues.length) return refuse("ia", `standard ${standardId} is not valid: ${standard.issues.slice(0, 5).join("; ")}`);
  if (!standardFits(standard.doc, "seat", contract)) return refuse("ia", `standard ${standardId} serves ${standard.doc.kinds.join(", ")}, not ${slotKinds("seat", contract).join(" or ")}`);
  // The seat is recorded at the position producer ia.json gives it (order only): a seat placed before
  // it by clossys seat once left its order stale (seatPositionWrites now follows in that write).
  const iaFile = iaPath(consumer, SEAT_AGENT);
  const position = modelExists(iaFile) ? slotPositions(SEAT_AGENT, readModelJson(iaFile) as IaDoc).get(slot) : undefined;
  if (!position) return refuse("ia", `${target} is not placed in producer ia.json: a seat is placed by clossys seat <step>`);
  const doc = { ...existing, ia: { ...position }, standard: standardId, contract };
  const docIssues = validateSlotDoc(doc, file);
  if (docIssues.length) return refuse("ia", docIssues.map(issue => issue.message).join("; "));
  const bytes = jsonBytes(doc);
  if (readModelText(file) === bytes) return { exitCode: 0, root, message: `ia: ${target} already names standard ${standardId}; nothing written` };
  return commitIa(consumer, root, [[file, bytes]], flags.bare.has("--dry"), `${target} standard ${standardId}${contractFile !== undefined ? " and contract" : ""}`, [], `ia: ${target} standard ${standardId} named (clossys/agents/${SEAT_AGENT}/${slot}/slot.json)`, iaWho(owner.ref, eventAt));
}
const rootConsumer = (cwd: string, flags: Flags) => join(rootOf(cwd, flags), "clossys");
const isRecordValue = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** `clossys ia sync [--check] [--agent <a>]`: the package IA against the consumer (foundry-feedback-0022). */
function runIaSync(flags: Flags, cwd: string): CliResult {
  const allowed = ["--agent", "--root"];
  const stray = [...[...flags.values.keys()].filter(flag => !allowed.includes(flag)), ...[...flags.bare].filter(flag => flag !== "--dry" && flag !== "--check")];
  if (stray.length || flags.positional.length > 1) throw new CliUsageError(`ia sync takes only --check, --agent, --dry and --root\n${IA_USAGE}`);
  const only = one(flags, "--agent");
  if (only !== undefined && !(SYNC_AGENTS as readonly string[]).includes(only)) throw new CliUsageError(`ia sync --agent takes one of ${SYNC_AGENTS.join(", ")}, got ${only}\n${IA_USAGE}`);
  const agents = (only === undefined ? SYNC_AGENTS : [only]) as SyncAgent[];
  const root = rootOf(cwd, flags), consumer = join(root, "clossys");
  const findings: SyncFinding[] = [];
  for (const agent of agents) findings.push(...syncDrift(consumer, agent));
  const counts = Object.fromEntries(agents.map(agent => [agent, driftCounts(findings.filter(finding => finding.agent === agent))]));
  const summary = agents.map(agent => {
    const entries = Object.entries(counts[agent]!);
    return `${agent}: ${entries.length ? entries.map(([kind, n]) => `${n} ${kind}`).join(", ") : "in sync"}`;
  });
  if (flags.bare.has("--check")) {
    const listed = findings.slice(0, 60).map(finding => `  ${finding.agent} ${finding.kind}: ${finding.detail}`);
    return {
      exitCode: findings.length ? 1 : 0, root, check: true, output: { drift: findings.length, counts, findings },
      message: [`ia sync --check: ${findings.length ? `${findings.length} drift finding${findings.length === 1 ? "" : "s"}` : "in sync with the package IA"}`, ...summary.map(line => `  ${line}`), ...listed, ...(findings.length > 60 ? [`  ... and ${findings.length - 60} more`] : [])].join("\n"),
    };
  }
  return refuse("ia", "sync writes land with SOURCE-MIGRATE step 3; run ia sync --check");
}

export async function runIaCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parseIa(argv);
  if (flags.help) return { exitCode: 0, message: IA_USAGE };
  if (flags.positional[0] === "sync") return runIaSync(flags, cwd);
  const [target, ...extra] = flags.positional;
  const dry = flags.bare.has("--dry");
  const whole = (["--adopt", "--start"] as const).filter(flag => flags.bare.has(flag));
  if (whole.length) {
    if (whole.length > 1 || !target || extra.length || target.includes("/") || flags.bare.has("--remove") || flags.bare.has("--move") || flags.values.size > (flags.values.has("--root") ? 1 : 0)) throw new CliUsageError(`ia ${whole.join(" ")} takes one agent and no other flag but --dry and --root\n${IA_USAGE}`);
    return whole[0] === "--adopt" ? adoptIa(target, rootOf(cwd, flags), dry) : startIa(target, rootOf(cwd, flags), dry);
  }
  const ops = Object.keys(REGROUP_OPS).filter(op => flags.values.has(op));
  if (ops.length > 1) throw new CliUsageError(`ia takes one regroup operation at a time, got ${ops.join(", ")}\n${IA_USAGE}`);
  if (ops.length) {
    if (!target || extra.length) throw new CliUsageError(`ia ${ops[0]} takes one <agent>\n${IA_USAGE}`);
    return runIaRegroup(flags, cwd, target, ops[0]!);
  }
  if (!target || extra.length) throw new CliUsageError(`ia takes one <agent>/<slot>\n${IA_USAGE}`);
  const slash = target.indexOf("/");
  const agent = target.slice(0, slash) as SlotAgent, slot = target.slice(slash + 1);
  if ((agent as string) === SEAT_AGENT && SLOT_ID.test(slot)) {
    // A placed seat moves like any slot (owner-authorized, slot.json follows); it is never placed here:
    // --under without --move (as with --contract) would create a seat, which only clossys seat <step> does.
    const step = seatStepOf(slot) ?? "<step>";
    if (flags.bare.has("--move")) {
      if (flags.values.has("--extension") || flags.bare.has("--remove")) throw new CliUsageError(`ia ${target} --move takes only --under, --owner-ref, --at, --dry and --root (a seat is never a consumer extension)\n${IA_USAGE}`);
      const seatIa = iaPath(rootConsumer(cwd, flags), SEAT_AGENT);
      if (!modelExists(seatIa)) return refuse("ia", `producer has no ia.json: a new seat is placed by clossys seat ${step}`);
      return runIaSlotRegroup(flags, rootConsumer(cwd, flags), rootOf(cwd, flags), SEAT_AGENT, slot, readModelJson(seatIa) as IaFile);
    }
    if (flags.values.has("--under")) throw new CliUsageError(`ia ${target} --under: a new seat is placed by clossys seat ${step}; a placed seat moves with --move --under <l1>/<l2> --owner-ref <ref>\n${IA_USAGE}`);
    return runIaSeatStandard(flags, cwd, target, slot);
  }
  if (!(SLOT_AGENTS as readonly string[]).includes(agent) || !SLOT_ID.test(slot)) throw new CliUsageError(`ia target must be <agent>/<slot> with agent ${SLOT_AGENTS.join(", ")} and a slot id, got ${target}\n${IA_USAGE}`);
  const root = rootOf(cwd, flags), consumer = join(root, "clossys");
  const iaFile = iaPath(consumer, agent);
  if (!modelExists(iaFile)) return refuse("ia", `${agent} has no ia.json: ${(FOUNDRY_IA_AGENTS as readonly string[]).includes(agent) ? `adopt the Foundry IA (clossys ia ${agent} --adopt) or start` : "start"} an empty one (clossys ia ${agent} --start)`);
  const ia = readModelJson(iaFile) as AgentIaFile;
  if (flags.bare.has("--move") || (flags.values.has("--extension") && !flags.values.has("--contract"))) {
    if (flags.bare.has("--remove")) throw new CliUsageError(`ia --remove takes no --move or --extension\n${IA_USAGE}`);
    return runIaSlotRegroup(flags, consumer, root, agent, slot, ia as unknown as IaFile);
  }
  if (flags.values.has("--extension")) throw new CliUsageError(`--extension is its own write: ia ${target} --extension true|false --owner-ref <ref>\n${IA_USAGE}`);
  // --owner-ref is optional here; when given it must resolve, and the write records it in ia.json changes[].
  const owner = ownerRefOf(flags, consumer, false);
  if (isResult(owner)) return owner;
  const at = owner.ref ? atOf(flags) : "";
  // The ledger events' time: --at when given (validated as a regroup's), else the write's.
  const eventAt = at || (flags.values.has("--at") ? atOf(flags) : "");
  const dir = slotDir(consumer, agent, slot);
  const placed = isPlaced(ia, slot);
  if (flags.bare.has("--remove")) {
    if (!placed) return refuse("ia", `${target} is not in ${agent} ia.json`);
    for (const file of [slotFile(dir), pinFile(dir)]) if (modelExists(file)) return refuse("ia", `${target} has ${file.slice(dir.length + 1)}; only a slot with no records leaves the IA`);
    if (listModelDir(candidatesDir(dir)).some(name => !name.startsWith("."))) return refuse("ia", `${target} has candidates; only a slot with no records leaves the IA`);
    let next = withoutSlot(ia, slot);
    // Later slots move up one order: their slot.json positions follow, as retire --slot renumbers.
    const follow = followPositions(consumer, agent, ia as unknown as IaFile, next as unknown as IaFile, undefined, slot);
    if ("error" in follow) return refuse("ia", follow.error);
    if (owner.ref) next = withChange(next, { op: "remove", ownerRef: owner.ref, at, detail: `removed ${slot}${renumbered(follow)}`, slotFiles: follow.writes.length });
    const issues = validateIa(next, iaFile);
    if (issues.length) return refuse("ia", issues.map(issue => issue.message).join("; "));
    return commitIa(consumer, root, [[iaFile, jsonBytes(next)], ...follow.writes], dry, `remove ${target} from ${agent} ia.json`, followLines(follow), `ia: removed ${target} from ${agent} ia.json`, iaWho(owner.ref, eventAt));
  }
  const standardId = one(flags, "--standard");
  if (standardId !== undefined && !STANDARD_ID.test(standardId)) throw new CliUsageError(`--standard must be a standard id such as element.button, got ${standardId}\n${IA_USAGE}`);
  // --standard alone keeps the slot's written contract; otherwise the contract file is required.
  const contractFile = standardId !== undefined && !flags.values.has("--contract") ? undefined : need(flags, "--contract", IA_USAGE);
  let contract: unknown;
  if (contractFile !== undefined) { try { contract = readJsonFile(resolve(cwd, contractFile)); } catch { return refuse("ia", `--contract ${contractFile} is not a readable JSON file`); } }
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
  // A slot placed before the end shifts every later slot's agent-wide order: their slot.json positions follow (order only).
  const follow = followPositions(consumer, agent, ia as unknown as IaFile, next as unknown as IaFile, undefined, slot);
  if ("error" in follow) return refuse("ia", follow.error);
  if (owner.ref) next = withChange(next, { op: placed ? "contract" : "place", ownerRef: owner.ref, at, detail: placed ? (contractFile === undefined ? `named the standard ${standardId} of ${slot}` : `wrote the contract of ${slot}`) : `placed ${slot} under ${one(flags, "--under")}${renumbered(follow)}`, slotFiles: 1 + follow.writes.length });
  const iaIssues = validateIa(next, iaFile);
  if (iaIssues.length) return refuse("ia", iaIssues.map(issue => issue.message).join("; "));
  const position = slotPositions(agent, next as unknown as IaDoc).get(slot);
  if (!position) return refuse("ia", `${target} has no position in ${agent} ia.json`);
  const existing = modelExists(slotFile(dir)) ? readModelJson(slotFile(dir)) as Record<string, unknown> : undefined;
  const kind = (one(flags, "--kind") ?? (existing?.kind as string | undefined) ?? AGENT_KIND[agent][0]) as SlotKind;
  if (!(SLOT_KINDS as readonly string[]).includes(kind)) throw new CliUsageError(`--kind must be one of ${SLOT_KINDS.join(", ")}\n${IA_USAGE}`);
  if (contractFile === undefined) {
    if (existing?.contract === undefined) return refuse("ia", `${target} has no written contract: --standard alone names the standard of a written slot (add --contract <file>)`);
    contract = existing.contract;
  }
  if (standardId !== undefined) {
    // The standard lives in the slot's own agent package (R15.1): it must exist, read clean and serve this kind.
    if (!existsSync(packagePath(root, `packages/${agent}/standards/${standardId}/requirements.json`))) return refuse("ia", `standard ${standardId} does not exist under packages/${agent}/standards/`);
    const standard = readStandard(root, agent as ModelAgent, standardId);
    if (!standard.doc || standard.issues.length) return refuse("ia", `standard ${standardId} is not valid: ${standard.issues.slice(0, 5).join("; ")}`);
    if (!standardFits(standard.doc, kind, contract)) return refuse("ia", `standard ${standardId} serves ${standard.doc.kinds.join(", ")}, not ${slotKinds(kind, contract).join(" or ")}`);
  }
  const doc = {
    ...(existing ?? {}), schema: SLOT_SCHEMA, id: slot, agent, ia: { ...position }, kind, ...(standardId !== undefined ? { standard: standardId } : {}), contract,
    inputs: flags.values.has("--inputs") ? ids(one(flags, "--inputs")) : (existing?.inputs as string[] | undefined) ?? [],
    uses: flags.values.has("--uses") ? ids(one(flags, "--uses")) : (existing?.uses as string[] | undefined) ?? [],
  };
  const docIssues = validateSlotDoc(doc, slotFile(dir));
  if (docIssues.length) return refuse("ia", docIssues.map(issue => issue.message).join("; "));
  const writes: [string, string][] = [...(next !== ia ? [[iaFile, jsonBytes(next)] as [string, string]] : []), [slotFile(dir), jsonBytes(doc)], ...follow.writes];
  const named = standardId !== undefined ? `, standard ${standardId} named` : "";
  const what = contractFile === undefined ? `standard ${standardId} named` : `${placed ? "contract written" : `placed under ${one(flags, "--under")} and its contract written`}${named}`;
  const summary = contractFile === undefined ? `${target} standard ${standardId}` : `${target} ${placed ? "contract" : `placed under ${one(flags, "--under")} and contract`}${standardId !== undefined ? `, standard ${standardId}` : ""}`;
  return commitIa(consumer, root, writes, dry, summary, followLines(follow), `ia: ${target} ${what} (clossys/agents/${agent}/${slot}/slot.json)`, iaWho(owner.ref, eventAt));
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
/**
 * Producer ia.json with `step` placed in its stage's group (`<round>.<stage>`), groups and rounds in pipeline order.
 * A new round or group takes its id as its label, as `ia --under` does: display names come from the Writer (records/slot-labels.ts iaLabel), never words made from the id.
 */
export function placeSeat(ia: { schema: string; source: string; extensions: string[]; nodes: { id: string; label: string; children: { id: string; label: string; slots: string[] }[] }[] }, step: Step) {
  const id = seatSlotId(step.id);
  if (ia.nodes.some(node => node.children.some(child => child.slots.includes(id)))) return ia;
  const round = roundOf(step.stage), rounds: readonly string[] = ROUNDS.map(each => each.id);
  const nodes = ia.nodes.map(node => ({ ...node, children: node.children.map(child => ({ ...child, slots: [...child.slots] })) }));
  let node = nodes.find(each => each.id === round);
  if (!node) {
    node = { id: round, label: round, children: [] };
    const at = nodes.findIndex(each => rounds.indexOf(each.id) > rounds.indexOf(round));
    nodes.splice(at < 0 ? nodes.length : at, 0, node);
  }
  let child = node.children.find(each => each.id === step.stage);
  if (!child) {
    child = { id: step.stage, label: step.stage, slots: [] };
    const at = node.children.findIndex(each => STAGES.indexOf(each.id as never) > STAGES.indexOf(step.stage));
    node.children.splice(at < 0 ? node.children.length : at, 0, child);
  }
  child.slots.push(id);
  return { ...ia, nodes };
}

/** A seat slot's candidate stem: the last dot segment of its slot id (seat.pick.designer -> designer). */
export const seatLeaf = (step: string): string => seatSlotId(step).split(".").at(-1)!;

/**
 * The seat slot.json rewrites (order and group only) that make every placed seat but `except` sit where
 * producer ia.json places it. Producer ia.json is derived from the pipeline steps, so its position always wins.
 */
export function seatPositionWrites(consumer: string, ia: IaDoc, except?: string): { writes: [string, string][] } | { error: string } {
  const writes: [string, string][] = [];
  for (const [id, at] of slotPositions(SEAT_AGENT, ia)) {
    if (id === except) continue;
    const file = slotFile(join(agentDir(consumer, SEAT_AGENT), id));
    if (!modelExists(file)) continue;
    const doc = JSON.parse(readModelText(file)) as Record<string, unknown>;
    if (jsonBytes(doc.ia) === jsonBytes(at)) continue;
    const nextDoc = { ...doc, ia: { ...at } };
    const issues = validateSlotDoc(nextDoc, file);
    if (issues.length) return { error: `producer/${id}: ${issues.map(issue => issue.message).join("; ")}` };
    writes.push([file, jsonBytes(nextDoc)]);
  }
  return { writes };
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
  // A seat candidate is named for its slot's leaf (the last dot segment of seat.<step>), like every
  // other candidate: seat.pick.designer's are designer-v<n>.json. The version counts every candidate
  // of the slot, retired ones too, so a number is never reused.
  const leaf = seatLeaf(id);
  const existing = [...listModelDir(candidatesDir(dir)), ...listModelDir(join(dir, RETIRED_DIR))].map(name => CANDIDATE_NAME.exec(name)).filter(match => match?.[1] === leaf).map(match => Number(match![2]));
  const name = `${leaf}-v${Math.max(0, ...existing) + 1}.json`;
  const bytes = jsonBytes(seat);
  const pin = { candidate: name, sha256: sha(bytes), decidedBy, basis: decidedBy.startsWith("planner") ? "planner" : "picked", at };
  const pinIssues = validatePin(pin);
  if (pinIssues.length) return refuse("seat", pinIssues.map(issue => issue.message).join("; "));
  const iaFile = iaPath(consumer, "producer");
  const ia = modelExists(iaFile) ? readModelJson(iaFile) as Parameters<typeof placeSeat>[0] : { schema: IA_SCHEMA, source: "@clossys/producer#src/pipeline/steps", extensions: [], nodes: [] };
  const placed = placeSeat(ia, step);
  const candidate = join(candidatesDir(dir), name);
  // A seat is a slot of kind seat (D5): its slot.json is written once, with the step and a sample seat as the contract fixture.
  const docFile = slotFile(dir);
  const slotId = seatSlotId(id);
  const doc = modelExists(docFile) ? undefined : {
    schema: SLOT_SCHEMA, id: slotId, agent: "producer", ia: slotPositions("producer", placed as IaDoc).get(slotId)!, kind: "seat",
    contract: { step: id, fixture: { step: id, seat } }, inputs: [], uses: [],
  };
  if (doc) { const docIssues = validateSlotDoc(doc, docFile); if (docIssues.length) return refuse("seat", docIssues.map(issue => issue.message).join("; ")); }
  // A seat placed before the end shifts every later seat's order: their slot.json positions follow in the same guarded write.
  const follow = seatPositionWrites(consumer, placed as IaDoc, slotId);
  if ("error" in follow) return refuse("seat", follow.error);
  const added = guarded(consumer, [iaFile, candidate, pinFile(dir), ...(doc ? [docFile] : []), ...follow.writes.map(([file]) => file)], () => {
    if (placed !== ia) replaceFile(iaFile, jsonBytes(placed));
    for (const [file, bytes] of follow.writes) replaceFile(file, bytes);
    if (doc) createModelFile(docFile, jsonBytes(doc));
    createModelFile(candidate, bytes);
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
export { RULES_FILE };

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

// ---------------------------------------------------------------- clossys owner-decision
const parseOwnerDecision = parser(OWNER_DECISION_USAGE, ["--ref", "--scope", "--quote-file", "--date", "--root"], []);

/**
 * `clossys owner-decision add`: the owner step that produces clossys/owner-decisions.json. One
 * decision per run, appended (`init` starts an empty registry); the whole document is validated (records/owner-decisions.ts) before the
 * write, and a comment id already registered is refused (a decision is never rewritten).
 */
export async function runOwnerDecisionCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parseOwnerDecision(argv);
  if (flags.help) return { exitCode: 0, message: OWNER_DECISION_USAGE };
  const [mode, ...extra] = flags.positional;
  if ((mode !== "add" && mode !== "init") || extra.length) throw new CliUsageError(`owner-decision takes add or init\n${OWNER_DECISION_USAGE}`);
  const rel = `clossys/${OWNER_DECISIONS_FILE}`;
  if (mode === "init") {
    const given = ["--ref", "--scope", "--quote-file", "--date"].filter(name => flags.values.has(name));
    if (given.length) throw new CliUsageError(`owner-decision init takes no ${given.join(", ")}\n${OWNER_DECISION_USAGE}`);
    const root = rootOf(cwd, flags);
    const file = join(root, "clossys", OWNER_DECISIONS_FILE);
    if (existsSync(file)) return refuse("owner-decision", `${rel} exists; add a decision with clossys owner-decision add`);
    replaceFile(file, jsonBytes({ schema: OWNER_DECISIONS_SCHEMA, decisions: [] }));
    return { exitCode: 0, root, message: `owner-decision: started an empty registry at ${rel}` };
  }
  const ref = need(flags, "--ref", OWNER_DECISION_USAGE).trim();
  const cited = ledgerComment(ref);
  if (!cited) return refuse("owner-decision", `--ref ${ref} is not a ledger ref (${OWNER_WORDS_REF_FORM}); a bare comment id does not name its issue`);
  const scope = need(flags, "--scope", OWNER_DECISION_USAGE).split(",").map(item => item.trim()).filter(Boolean);
  const unknown = scope.filter(item => !(OWNER_DECISION_SCOPES as readonly string[]).includes(item));
  if (!scope.length || unknown.length) return refuse("owner-decision", `--scope must list one or more of ${OWNER_DECISION_SCOPES.join(", ")}${unknown.length ? ` (not ${unknown.join(", ")})` : ""}`);
  const quoteFile = need(flags, "--quote-file", OWNER_DECISION_USAGE);
  let quote: string;
  try { quote = readFileSync(resolve(cwd, quoteFile), "utf8").replace(/\r?\n$/, ""); } catch { return refuse("owner-decision", `cannot read --quote-file ${quoteFile}`); }
  if (!quote.trim() || /[\r\n]/.test(quote)) return refuse("owner-decision", "--quote-file holds the owner's words on one non-empty line");
  const date = one(flags, "--date") ?? new Date().toISOString().slice(0, 10);
  const root = rootOf(cwd, flags);
  const file = join(root, "clossys", OWNER_DECISIONS_FILE);
  let doc: { schema: string; decisions: OwnerDecision[] } = { schema: OWNER_DECISIONS_SCHEMA, decisions: [] };
  if (existsSync(file)) {
    let value: unknown;
    try { value = readJsonFile(file); } catch { return refuse("owner-decision", `${rel} is not JSON`); }
    const issues = validateOwnerDecisions(value);
    if (issues.length) return refuse("owner-decision", `${rel} is invalid before the write: ${issues.slice(0, 3).join("; ")}`);
    doc = value as typeof doc;
  }
  if (doc.decisions.some(decision => decision.id === cited.comment)) return refuse("owner-decision", `decision ${cited.comment} is registered; a decision is never rewritten (register a new ledger comment)`);
  const decision: OwnerDecision = { id: cited.comment, ref, date, scope: scope as OwnerDecision["scope"], summary: quote.trim() };
  const next = { schema: doc.schema, decisions: [...doc.decisions, decision] };
  const issues = [...validateOwnerDecisions(next), ...validateValue(next, loadSchema("owner-decisions")).map(issue => `${issue.path} ${issue.message}`)];
  if (issues.length) return refuse("owner-decision", issues.slice(0, 5).join("; "));
  replaceFile(file, jsonBytes(next));
  return { exitCode: 0, root, decision, message: `owner-decision: registered ${cited.comment} (${scope.join(", ")}, ${date}) in ${rel}` };
}

// ---------------------------------------------------------------- clossys retire
export const RETIRE_USAGE = "Usage: clossys retire <agent>/<slot> <candidate> --by <who> --reason <code>[: <note>] [--at <iso>] [--root <dir>]\n"
  + "       clossys retire <agent>/<slot> --slot --by <who> --reason <code>[: <note>] [--at <iso>] [--root <dir>]\n"
  + "  <code> is one of uncertified, superseded, edited-in-place, not-needed, duplicate, shared-split (constitution R10).\n"
  + "  retires one candidate: writes <slot>/retired/<candidate>.json (clossys.retire/1: slot id, candidate, sha256, by, reason, at) and moves\n"
  + "  the candidate file from candidates/ into retired/. The pinned candidate is refused: repin first.\n"
  + "  --slot retires a whole slot: it leaves its agent's ia.json, the removal is recorded in that ia.json's `retired` list, and its folder\n"
  + "  moves to agents/<agent>/_retired/<slot>. Refused while another slot.json `uses` it or a pinned slot takes it as an input.";
/** The schema of a retirement record: a retired candidate's file, or a row of an agent ia.json's `retired` list. */
/** A retire record's schema; the one writer owns the constant (records/slot-write.ts). */
export { RETIRE_SCHEMA };
/** A slot's retired candidates and their records: `<slot>/retired/<candidate>` and `<slot>/retired/<candidate>.json`. */
export { RETIRED_DIR };
/** Retired slot folders, a non-slot (`_`) folder of the agent: `agents/<agent>/_retired/<slot>`. */
export const RETIRED_SLOTS_DIR = "_retired";
const parseRetire = parser(RETIRE_USAGE, ["--by", "--reason", "--at", "--root"], ["--slot"]);
interface RetireFields { by: string; reason: string; at: string }

/** Remove a folder this verb created when an undo left it empty (records/slot-write.ts). */
const dropEmptyDir = dropEmptyModelDir;

function retireCandidate(consumer: string, root: string, agent: SlotAgent, slot: string, candidateId: string, fields: RetireFields): CliResult {
  const target = `${agent}/${slot}`;
  const entry = readSlotEntry(consumer, agent, slot);
  if (!entry) return refuse("retire", `unknown slot ${target} (not in ${agent} ia.json)`);
  const candidate = resolveCandidate(entry.candidates, candidateId);
  if (!candidate) return refuse("retire", `${target} has no candidate ${candidateId}`);
  // A present pin.json names the pinned candidate even when it no longer validates: never retire what it names.
  const pinText = readSlotRecordText(entry.dir, "pin.json");
  let pinned = entry.pin?.candidate;
  if (!pinned && pinText !== undefined) { try { pinned = (JSON.parse(pinText) as { candidate?: string }).candidate; } catch { pinned = undefined; } }
  if (pinned === candidate) return refuse("retire", `${candidate} is the pinned candidate of ${target}; repin first (clossys pin ${target} <candidate>)`);
  const from = join(candidatesDir(entry.dir), candidate);
  const retired = join(entry.dir, RETIRED_DIR), to = join(retired, candidate), file = join(retired, `${candidate}.json`);
  if (modelExists(to) || modelExists(file)) return refuse("retire", `${target} already has ${RETIRED_DIR}/${candidate}`);
  // `slot` is the slot id (the folder names the agent), as constitution R10.1 and retire.schema.json read it.
  const record = { schema: RETIRE_SCHEMA, slot, candidate, sha256: sha(readModelBytes(from)), by: fields.by, reason: fields.reason, at: fields.at };
  // The record validates against the constitution's retire.schema.json before anything moves (R10.1).
  const recordIssues = validateAgainst("retire", record);
  if (recordIssues.length) return refuse("retire", `the retire record does not validate against retire.schema.json: ${recordIssues.map(issue => `${issue.at || "/"} ${issue.message}`).join("; ")}`);
  // The slot model check reads retired/ too: the record must validate and match the moved bytes.
  // The retire verb's ledger event lands with the move (records/slot-write.ts); a refused write restores the ledger too.
  const added = guarded(consumer, [file, from, to, join(entry.dir, LEDGER_FILE)], () => {
    replaceFile(file, jsonBytes(record)); moveModelEntry(from, to);
    appendRetireCandidate(consumer, agent, slot, { name: candidate, sha256: record.sha256, reason: fields.reason, by: fields.by, at: fields.at });
  });
  if (added.length) { dropEmptyDir(retired); return refuse("retire", `the slot model check fails after the write: ${added.slice(0, 5).join("; ")}`); }
  return { exitCode: 0, root, decision: { slot: target, retired: candidate, sha256: record.sha256, by: fields.by, at: fields.at }, message: `retire: ${target} ${candidate} retired by ${fields.by} (clossys/agents/${agent}/${slot}/${RETIRED_DIR}/${candidate}.json)` };
}

function retireSlot(consumer: string, root: string, agent: SlotAgent, slot: string, fields: RetireFields): CliResult {
  const target = `${agent}/${slot}`;
  const iaFile = iaPath(consumer, agent);
  if (!modelExists(iaFile)) return refuse("retire", `${agent} has no ia.json`);
  const ia = readModelJson(iaFile) as AgentIaFile;
  if (!isPlaced(ia, slot)) return refuse("retire", `${target} is not in ${agent} ia.json`);
  let users: { agent: SlotAgent; id: string }[];
  try { users = usedBy(consumer, slot).filter(user => !(user.agent === agent && user.id === slot)); }
  catch (error) { return refuse("retire", `cannot read every slot.json to find what uses ${target}: ${error instanceof Error ? error.message : String(error)}`); }
  if (users.length) return refuse("retire", `${target} is used by ${users.map(user => `${user.agent}/${user.id}`).join(", ")}; change their uses first`);
  const dependents: string[] = [];
  for (const other of SLOT_AGENTS) for (const entry of listSlots(consumer, other)) {
    if ((other === agent && entry.id === slot) || !entry.pin) continue;
    let inputs: readonly string[];
    try { inputs = readSlot(consumer, other, entry.id).inputs; } catch { continue; }
    if (inputs.includes(slot)) dependents.push(`${other}/${entry.id}`);
  }
  if (dependents.length) return refuse("retire", `pinned slots take ${target} as an input: ${dependents.join(", ")}; repin or change their inputs first`);
  const dir = slotDir(consumer, agent, slot), to = join(agentDir(consumer, agent), RETIRED_SLOTS_DIR, slot);
  if (modelExists(to)) return refuse("retire", `agents/${agent}/${RETIRED_SLOTS_DIR}/${slot} exists; ${target} was retired before`);
  const slotBytes = modelExists(slotFile(dir)) ? readModelBytes(slotFile(dir)) : undefined;
  const history = Array.isArray(ia.retired) ? ia.retired as unknown[] : [];
  const record = { schema: RETIRE_SCHEMA, slot: target, sha256: slotBytes ? sha(slotBytes) : null, by: fields.by, reason: fields.reason, at: fields.at };
  const next = { ...withoutSlot(ia, slot), retired: [...history, record] };
  const issues = validateIa(next, iaFile);
  if (issues.length) return refuse("retire", issues.map(issue => issue.message).join("; "));
  // Positions number slots across the whole agent IA: every slot after the retired one moves up, so its slot.json follows.
  const was = slotPositions(agent, ia as unknown as IaDoc), now = slotPositions(agent, next as unknown as IaDoc);
  const renumbered: [string, string][] = [];
  for (const [id, position] of now) {
    const file = slotFile(slotDir(consumer, agent, id));
    if (!modelExists(file)) continue;
    const doc = readModelJson(file) as Record<string, unknown> & { ia?: unknown };
    if (jsonBytes(doc.ia) === jsonBytes(position) || jsonBytes(doc.ia) !== jsonBytes(was.get(id))) continue;
    renumbered.push([file, jsonBytes({ ...doc, ia: position })]);
  }
  const folder = isModelDir(dir);
  const moveBack = () => { if (folder && modelExists(to) && !modelExists(dir)) moveModelEntry(to, dir); dropEmptyDir(dirname(to)); };
  // Ledger events (records/slot-write.ts): each renumbered slot.json, then retire-slot in the slot's
  // ledger and the agent ledger, before the folder moves; a refused write restores every ledger.
  const ledgers = [join(agentDir(consumer, agent), LEDGER_FILE), join(dir, LEDGER_FILE), ...renumbered.map(([file]) => join(dirname(file), LEDGER_FILE))];
  const added = guarded(consumer, [iaFile, ...renumbered.map(([file]) => file), ...ledgers], () => {
    replaceFile(iaFile, jsonBytes(next));
    for (const [file, bytes] of renumbered) {
      replaceFile(file, bytes);
      appendSlotDocEvent(consumer, agent, (JSON.parse(bytes) as { id: string }).id, { by: fields.by, at: fields.at, verb: "retire", skill: skillPath("producer", "retire"), fields: { reason: `renumbered after ${target} retired` } });
    }
    appendRetireSlot(consumer, agent, slot, { reason: fields.reason, by: fields.by, at: fields.at });
    if (folder) moveModelEntry(dir, to);
  }, { undo: moveBack });
  if (added.length) return refuse("retire", `the slot model check fails after the removal: ${added.slice(0, 5).join("; ")}`);
  return { exitCode: 0, root, decision: { slot: target, retired: "slot", sha256: record.sha256, by: fields.by, at: fields.at }, message: `retire: ${target} left ${agent} ia.json, retired by ${fields.by}${folder ? ` (its folder is clossys/agents/${agent}/${RETIRED_SLOTS_DIR}/${slot})` : ""}` };
}

export async function runRetireCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parseRetire(argv);
  if (flags.help) return { exitCode: 0, message: RETIRE_USAGE };
  const whole = flags.bare.has("--slot");
  const [target, candidate, ...extra] = flags.positional;
  if (!target || extra.length || (whole ? candidate !== undefined : candidate === undefined)) throw new CliUsageError(`retire takes <agent>/<slot> and a candidate, or <agent>/<slot> --slot\n${RETIRE_USAGE}`);
  const slash = target.indexOf("/");
  const agent = target.slice(0, slash) as SlotAgent, slot = target.slice(slash + 1);
  if (slash < 0 || !(SLOT_AGENTS as readonly string[]).includes(agent) || !SLOT_ID.test(slot)) throw new CliUsageError(`retire target must be <agent>/<slot> with agent ${SLOT_AGENTS.join(", ")} and a slot id, got ${target}\n${RETIRE_USAGE}`);
  const by = need(flags, "--by", RETIRE_USAGE), reason = need(flags, "--reason", RETIRE_USAGE);
  if (/[\r\n]/.test(by) || /[\r\n]/.test(reason)) return refuse("retire", "--by and --reason are one line each");
  if (!RETIRE_REASON.test(reason)) throw new CliUsageError(`--reason must be a retire code (${RETIRE_CODES.join(", ")}), optionally followed by ": <note>", got ${reason}\n${RETIRE_USAGE}`);
  const at = one(flags, "--at") ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) throw new CliUsageError(`--at must be an ISO timestamp\n${RETIRE_USAGE}`);
  const root = rootOf(cwd, flags), consumer = join(root, "clossys");
  return whole ? retireSlot(consumer, root, agent, slot, { by, reason, at }) : retireCandidate(consumer, root, agent, slot, candidate!, { by, reason, at });
}
