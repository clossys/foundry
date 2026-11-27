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
 *   clossys config --init [--from <file>] [--root <dir>]   (also writes clossys/components.json, the shadcn flavor)
 *   clossys seat <step> --by <who> ((--model <id> --tier low|mid|high | --llm-from <step>) --prompt-file <path> | --no-llm) [--procedure <text> --command <verb>] --decided-by owner:queue.<kind>#<id>|planner[:<ref>] [--root <dir>]
 *   clossys rule --init [--root <dir>]
 *   clossys rule <R-ID> --quote <text> --date <YYYY-MM-DD> --status enforced|unenforced|pending-wire [--check <id>]... [--fixture <path>] [--fixture-run <cmd>]... [--note <text>] [--replace] [--root <dir>]
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
import { packagePath, PRODUCER_ROOT } from "../package-path.js";
import { checkSlotModel, RETIRED_DIR } from "../records/slot-check.js";
import { ledgerComment, OWNER_DECISION_SCOPES, OWNER_DECISIONS_FILE, OWNER_DECISIONS_SCHEMA, resolveOwnerRef, validateOwnerDecisions, type OwnerDecision } from "../records/owner-decisions.js";
import { AGENT_KIND, CANDIDATE_NAME, OWNER_WORDS_REF_FORM, FOUNDRY_IA_AFTER, FOUNDRY_IA_AGENTS, IA_SCHEMA, SEAT_AGENT, SLOT_AGENTS, SLOT_ID, SLOT_KINDS, SLOT_SCHEMA, STANDARD_ID, seatSlotId, seatStepOf } from "../records/slot-model/types.js";
import type { IaDoc, SlotAgent, SlotKind } from "../records/slot-model/types.js";
import { WORKSPACE_OWNED_SOURCE } from "../records/slot-model/ia-source.js";
import { agentDir, candidatesDir, iaPath, jsonBytes, pinFile, seatDir, slotDir, slotFile } from "../records/slot-model/layout.js";
import { designerIa, directorIa, packageLevels, slotPositions, writerIa, type FoundryIa } from "../records/slot-model/foundry-ia.js";
import { feedsIndex } from "../records/slot-model/derive.js";
import { PRODUCER_IA_SOURCE, readPipelineSeats } from "../records/slot-model/pipeline-seats.js";
import { adoptedCurrentSlots, driftCounts, holdsRecord, knownSlots, RETIRED_SEATS_DIR, SYNC_AGENTS, syncPlan, syncState, syncVerdict, type SeatRetire, type SyncAgent, type SyncVerdict } from "../records/slot-model/ia-sync.js";
import { consumedIds, consumedLeaves, filterFoundryIa, filterIa, scopedToConsumed } from "../records/slot-model/consumed.js";
import { consumerGraph, PublisherDataError } from "../check/ia-orphans.js";
import { pinRecords, validateIa, validatePin, validateSlotDoc } from "../records/slot-model/validate.js";
import { isModelDir, listModelDir, listSlots, modelExists, readModelBytes, readModelText, readSlot, readSlotEntry, readSlotRecordText, usedBy, withModelOverlay } from "../records/slots.js";
import { RETIRE_SCHEMA, appendIaEvent, appendRetireCandidate, appendRetireSlot, retireAnswerUses, retireBinding, appendSlotDocEvent, createModelFile, dropEmptyModelDir, logSlotFolderMove, moveModelEntry, removeModelFile, replaceModelFile, writeSeatDecision } from "../records/slot-write.js";
import "../constitution/guard.js"; // registers the write guard's runner (seat)
import { LEDGER_FILE, skillPath } from "../records/ledger.js";
import { readStandard, slotKinds, standardFits } from "../records/standards.js";
import type { ModelAgent } from "../records/slot-model/index.js";
import { isDecide, roundOf, ROUNDS, STAGES } from "../pipeline/define.js";
import type { Step } from "../pipeline/define.js";
import { loadSchema, validateFile, validateValue } from "../pipeline/schema.js";
import { readSeat } from "../pipeline/seats.js";
import { SEAT_POLICY_FILE, SEAT_POLICY_SCHEMA, validateSeatPolicy } from "../pipeline/seat-policy.js";
import { STEPS } from "../pipeline/steps/index.js";
import { RETIRE_CODES, RETIRE_REASON } from "../constitution/checks/R10-retire.js";
import { validateAgainst } from "../constitution/schema.js";
import { IA_KIND, slotWriteKind } from "../constitution/green.js";
import { oldSlotRefusal, resolveCandidate } from "./pin.js";
import { readPinFile } from "../records/pin-map.js";
import { errorMessage } from "../errors.js";
import { FLAVOR_FILE, writeFlavor } from "../records/consumer-flavor.js";
import { consumerSlotFolders, positionIa, serializeSlot, SLOT_SCHEMA as SLOT_V2_SCHEMA, validateSlot } from "../records/slot.js";
import { currentView, slotReadIssues } from "../records/slot-current.js";
import { buildPin, cliActor, ownerAnswerRef, pinIssues, toIsoZ } from "../records/pin.js";
import { seatSlot } from "../records/seat-slot.js";
import { recutCandidateBytes } from "../migrate/recut.js";
import { listedPublications, PUBLICATION_ID, publicationOf, RELEASE_SLOT, releaseSlotId } from "../release/paths.js";
import { actorRefusal } from "../records/seat-owner.js";
import { ownerDecisionRefusal } from "../records/owner-answer.js";
import { slotFromV1, targetKind, type SlotV1 } from "../migrate/slot-1-to-2.js";
import { markCurrentStore } from "../migrate/slots.js";
import type { AgentId, IaPublication, Iso, Ref, Slot, TargetSlotKind } from "../records/types.js";
import { CliUsageError } from "./args.js";
import { addGroup, assignGroup, dropGroup, followPositions, mergeGroups, moveSlot, packageStructureChange, planIaWrite, renameGroup, reorderGroup, setAxes, setExtension, setLayers, type Edit, type IaFile, type PositionFollow } from "./ia-regroup.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";
import { RULES_FILE } from "./rules-file.js";
import { AGENT_LOOPS, isLoopAgent } from "../loop/agent-loops-ia.js";
import { closeRequest, isContentAgent, overlapRefusal, ownerOfNeed, placementContractIssues, placementOverlaps, raiseRequest, readRequest, RequestError, rerouteOpenEntries, signedApproval, targetOf, type SlotRequest } from "../records/request.js";

export const IA_USAGE = "Usage: clossys ia <agent>/<slot> --contract <file> [--standard <id>] [--under <l1>/<l2>] [--kind <kind>] [--inputs <id,...>] [--uses <id,...>] [--owner-ref <ref> [--overlap-reason <text>]] [--dry] [--root <dir>]\n"
  + "       clossys ia <agent>/<slot> --standard <id> [--owner-ref <ref>] [--dry] [--root <dir>]\n"
  + "       clossys ia producer/<seat> --standard <id> [--contract <file>] [--owner-ref <ref>] [--dry] [--root <dir>]\n"
  + "       clossys ia producer/<seat> --move --under <l1>/<l2> --owner-ref <ref> [--dry] [--root <dir>]  (a placed seat; a new seat is placed by clossys seat <step>)\n"
  + "       clossys ia publisher/release.<pub> --kind release --contract <file> [--standard release] [--under <l1>/<l2>] [--owner-ref <ref>] [--dry] [--root <dir>]\n"
  + "       clossys ia <agent>/<slot> --remove [--owner-ref <ref>] [--dry] [--root <dir>]\n"
  + "       clossys ia <agent>/<slot> --request <id> --approved queue.approve#<id> [--at <iso>] [--dry] [--root <dir>]  (places the leaf a create decision proposes; clossys request <id> --close runs it)\n"
  + "       clossys ia <agent> --adopt | --start [--dry] [--root <dir>]\n"
  + "       clossys ia publisher --publication <pub> [--dry] [--root <dir>]\n"
  + "       clossys ia sync [--check] [--agent <agent>] [--at <iso>] [--dry] [--root <dir>]\n"
  + "  places a slot in its agent's ia.json (--under, when it is not placed yet) and writes its slot.json with the contract (a JSON object file).\n"
  + "  A content agent's contract (new or rewritten) must be valid for its kind family and name registered requirements. A new leaf\n"
  + "  over a placed slot of one L2 and kind family with overlapping inputs is refused (cite it) unless --overlap-reason and\n"
  + "  --owner-ref sign why the material differs (a --request placement carries the reason its decision recorded).\n"
  + "  --standard names the standard the slot is judged by (packages/<agent>/standards/<id>/, R15.1): it must exist, be valid and serve the slot's kind; alone it keeps the written contract.\n"
  + "  producer/<seat>: names the standard of a seat slot clossys seat wrote (kind seat); --contract may add requirements but keeps the seat's step. Nothing else of a seat is written here.\n"
  + "  publisher/release.<pub>: creates the release slot (clossys.slot/2 kind release) of an existing publication <pub> (a placed\n"
  + "  publisher/publication.<pub> slot or a publisher ia.json publication), once; its candidates are the manifests clossys publisher release <pub> --manifest writes.\n"
  + "  --adopt writes the agent's Foundry IA (ia.json and every slot.json, inputs and uses derived) where it has no ia.json (Director, Designer, Writer; the Director's first).\n"
  + "  --start writes an empty workspace IA instead; --under then adds its L1/L2 groups as it places each slot.\n"
  + "  --publication writes one publications entry of the Publisher workspace IA, from the package directory L2 that names <pub>\n"
  + "  (its node and pages) and the package starter of <pub> (root, chrome, release, redirects); a release slot then places for it.\n"
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
  + "  writes clossys/clossys.config.ts (the default config, or --from a config file) when the workspace has none; with one, validates it.\n"
  + "  then writes clossys/components.json, the Designer's shadcn flavor the workspace's pinned components render in, unless it\n"
  + "  already holds it (an invalid config writes neither).";
export const SEAT_USAGE = "Usage: clossys seat <step> --by <who> (--model <id> --tier low|mid|high | --llm-from <step>) --prompt-file <path> [--procedure <text> --command <verb>] --decided-by owner:queue.<kind>#<id>|planner[:<ref>] [--root <dir>]\n"
  + "       clossys seat <step> --by <who> --no-llm [--procedure <text> --command <verb>] --decided-by owner:queue.<kind>#<id>|planner[:<ref>] [--root <dir>]\n"
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
  "--contract", "--standard", "--under", "--kind", "--inputs", "--uses", "--root", "--owner-ref", "--at", "--extension", "--request", "--approved", "--overlap-reason",
  "--add", "--rename", "--merge", "--into", "--drop", "--reorder", "--order", "--assign", "--layer", "--label", "--id", "--layers", "--axes", "--agent", "--publication",
], ["--remove", "--adopt", "--start", "--move", "--dry", "--check"]);
const FOUNDRY_IA: Readonly<Record<keyof typeof FOUNDRY_IA_AFTER, () => FoundryIa>> = { director: directorIa, designer: designerIa, writer: writerIa };
/** The source of a workspace-owned IA (`--start`): `--under` may add L1/L2 groups to it, never to a Foundry IA. */
export const WORKSPACE_IA_SOURCE = WORKSPACE_OWNED_SOURCE;
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
function commitIa(consumer: string, root: string, writes: readonly (readonly [string, string])[], dry: boolean, summary: string, lines: readonly string[] = [], message = `ia: ${summary}`, who: IaWho = {}, extra: ReadonlyMap<string, Readonly<Record<string, unknown>>> = new Map(), moves: readonly SeatRetire[] = []): CliResult {
  const rel = (path: string) => relative(root, path).split(sep).join("/");
  if (dry) {
    const files = [...writes.map(([path]) => rel(path)), ...moves.map(move => `${rel(move.from)}/ -> ${rel(move.to)}/`)];
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
  // A retired seat's folder moves whole after the files (the `clossys retire --slot` place); an undo moves it back.
  const moveBack = () => { for (const move of [...moves].reverse()) { if (modelExists(move.to) && !modelExists(move.from)) moveModelEntry(move.to, move.from); dropEmptyDir(dirname(move.to)); } };
  const added = guarded(consumer, [...writes.map(([path]) => path), ...ledgers], () => {
    for (const [path, bytes] of writes) replaceFile(path, bytes);
    for (const target of targets) {
      if (target.slot === undefined) appendIaEvent(consumer, target.agent, { by, at, fields: { kind: target.kind } });
      else appendSlotDocEvent(consumer, target.agent, target.slot, { by, at, verb: "ia", skill: skillPath("producer", "ia"), fields: { kind: target.kind, ...(extra.get(`${target.agent}/${target.slot}`) ?? {}) } });
    }
    for (const move of moves) moveModelEntry(move.from, move.to);
  }, { undo: moveBack });
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
/**
 * Whether a leaf is a package leaf of the agent's installed Foundry IA (the whole catalog, not the consumed scope, plus
 * the Producer-standard loop leaves for a loop agent, as `ia sync` and R01.5 count them), for
 * a package-sourced IA. Undefined (every placed leaf guarded) for any other IA, or when the package IA does not read:
 * an absent source refuses, it never lets a flip through (DECIDED D3).
 */
function packageLeafTest(agent: ModelAgent, ia: IaFile): ((slot: string) => boolean) | undefined {
  if (typeof ia.source !== "string" || !ia.source.startsWith(`@clossys/${agent}#`) || !Object.hasOwn(FOUNDRY_IA, agent)) return undefined;
  let leaves: ReadonlySet<string>;
  try { leaves = new Set([...FOUNDRY_IA[agent as keyof typeof FOUNDRY_IA]().slots.keys(), ...(isLoopAgent(agent) ? AGENT_LOOPS : [])]); } catch { return undefined; }
  return slot => leaves.has(slot);
}
/** An edit, planned (slot.json positions follow, the owner ref recorded) and committed, or printed under --dry. */
function applyEdit(consumer: string, root: string, agent: ModelAgent, ia: IaFile, edit: Edit, op: string, ownerRef: string, at: string, dry: boolean): CliResult {
  if ("error" in edit) return refuse("ia", edit.error);
  if ("unchanged" in edit) return { exitCode: 0, root, message: `ia: ${edit.unchanged}; nothing written` };
  const structure = packageStructureChange(ia, edit.ia, packageLeafTest(agent, ia));
  if (structure) return refuse("ia", structure);
  const plan = planIaWrite(consumer, agent, ia, edit, { op, ownerRef, at });
  if ("error" in plan) return refuse("ia", plan.error);
  if ("unchanged" in plan) return { exitCode: 0, root, message: `ia: ${plan.unchanged}; nothing written` };
  return commitIa(consumer, root, plan.writes, dry, `${agent} ${edit.detail}`, plan.lines, undefined, iaWho(ownerRef, at));
}

/**
 * The `publications` entry of publication `pub` from the installed Publisher package: the directory L2 whose
 * `publication` is `pub` gives the node and its pages (in tree order); the package starter of `pub` gives the root,
 * chrome, release slot and redirects. An error names the package data that is missing or disagrees.
 */
export function packagePublication(root: string, pub: string): IaPublication | { error: string } {
  const directoryFile = packagePath(root, "packages/publisher/src/catalog/ia/directory.json");
  let directory: { nodes?: { parked?: boolean; children?: { id?: string; parked?: boolean; publication?: string; leaves?: string[] }[] }[] };
  try { directory = readJsonFile(directoryFile) as typeof directory; } catch (error) { return { error: `the Publisher package directory tree does not read (${errorMessage(error)})` }; }
  const groups = (directory.nodes ?? []).filter(l1 => !l1.parked).flatMap(l1 => (l1.children ?? []).filter(l2 => !l2.parked && l2.publication === pub));
  if (groups.length !== 1) return { error: `the Publisher package directory has ${groups.length ? `${groups.length} live L2 groups` : "no live L2 group"} with publication ${pub}` };
  const group = groups[0]!;
  const pages = [...(group.leaves ?? [])];
  let starter: { id?: unknown; node?: unknown; root?: unknown; pages?: unknown; chrome?: unknown; release?: unknown; redirects?: unknown };
  try { starter = readJsonFile(packagePath(root, `packages/publisher/starters/${pub}/publication.json`)) as typeof starter; } catch (error) { return { error: `the Publisher package has no readable starter for ${pub} (${errorMessage(error)})` }; }
  const listed = Array.isArray(starter.pages) ? starter.pages : [];
  if (starter.id !== pub || starter.node !== group.id || listed.length !== pages.length || !pages.every(page => listed.includes(page))) return { error: `the Publisher starter ${pub} does not match directory ${group.id} (its id, node or pages differ)` };
  if (typeof starter.root !== "string" || !Array.isArray(starter.chrome) || typeof starter.release !== "string" || !Array.isArray(starter.redirects)) return { error: `the Publisher starter ${pub} names no root, chrome, release or redirects` };
  return { node: group.id!, starter: pub, root: starter.root, pages: pages as IaPublication["pages"], chrome: starter.chrome as IaPublication["chrome"], release: starter.release as IaPublication["release"], redirects: starter.redirects as IaPublication["redirects"] };
}

/** `clossys ia publisher --publication <pub>`: one `publications` entry of the Publisher workspace IA, from package data. */
function publicationIa(pub: string, root: string, dry: boolean): CliResult {
  if (!PUBLICATION_ID.test(pub)) throw new CliUsageError(`--publication must be a publication id such as site, got ${pub}\n${IA_USAGE}`);
  const consumer = join(root, "clossys"), iaFile = iaPath(consumer, "publisher");
  if (!modelExists(iaFile)) return refuse("ia", "publisher has no ia.json: start an empty one (clossys ia publisher --start)");
  const ia = readModelJson(iaFile) as AgentIaFile & { publications?: Record<string, IaPublication> };
  if (ia.source !== WORKSPACE_IA_SOURCE) return refuse("ia", `publisher ia.json is not the workspace's own IA (source ${JSON.stringify(ia.source)})`);
  const entry = packagePublication(root, pub);
  if ("error" in entry) return refuse("ia", entry.error);
  const held = ia.publications?.[pub];
  if (held !== undefined) {
    if (JSON.stringify(held) === JSON.stringify(entry)) return { exitCode: 0, root, message: `ia: publisher publication ${pub} is already recorded; nothing written` };
    return refuse("ia", `publisher ia.json already records publication ${pub}, and it differs from the package`);
  }
  const next = { ...ia, publications: { ...(ia.publications ?? {}), [pub]: entry } };
  const issues = validateIa(next, iaFile);
  if (issues.length) return refuse("ia", issues.map(issue => issue.message).join("; "));
  return commitIa(consumer, root, [[iaFile, jsonBytes(next)]], dry, `recorded publication ${pub} in publisher ia.json`, [],
    `ia: recorded publication ${pub} (${entry.node}, ${entry.pages.length} pages, release ${entry.release}) in clossys/agents/publisher/ia.json`);
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

/**
 * `clossys ia <agent> --adopt`: the agent's Foundry IA and every slot.json, written only where the agent has no ia.json.
 * Only the package leaves a declared or seated publication reaches are placed (CONSISTENCY D5 option 1, consumed.ts):
 * code decides which, and a skipped leaf stays adoptable through `clossys request`. Where the agent has an ia.json, the
 * re-run takes the placed package leaves no publication reaches out of the tree (pruneUnconsumed). The Director is not
 * scoped (scopedToConsumed): it places every catalog leaf once, and its re-run removes nothing.
 */
export function adoptIa(agent: string, root: string, dry: boolean): CliResult {
  if (!(FOUNDRY_IA_AGENTS as readonly string[]).includes(agent)) throw new CliUsageError(`ia --adopt takes ${FOUNDRY_IA_AGENTS.join(", ")}; the Publisher IA is the workspace's own (ia publisher --start)\n${IA_USAGE}`);
  const read = FOUNDRY_IA[agent as keyof typeof FOUNDRY_IA], after = FOUNDRY_IA_AFTER[agent as keyof typeof FOUNDRY_IA];
  const consumer = join(root, "clossys"), iaFile = iaPath(consumer, agent as SlotAgent);
  if (modelExists(iaFile)) return scopedToConsumed(agent) ? pruneUnconsumed(agent, consumer, root, iaFile, dry)
    : { exitCode: 0, root, message: `ia: ${agent} ia.json exists and places the whole catalog; nothing to remove (change it slot by slot: --under, --remove)` };
  const first = after.filter(up => !modelExists(iaPath(consumer, up)));
  if (first.length) return refuse("ia", `adopt the ${first.join(", ")} IA first: ${agent} slots read its slots`);
  const whole = read();
  const foundry = scopedToConsumed(agent) ? filterFoundryIa(whole, consumedIds(consumedLeaves(root), agent)) : whole;
  // Refs resolve against the slots this workspace places, plus the adopted ones; the Director's feeds become downstream inputs.
  const known = new Set(foundry.slots.keys());
  for (const other of SLOT_AGENTS) if (other !== agent && modelExists(iaPath(consumer, other))) {
    for (const id of slotPositions(other, readModelJson(iaPath(consumer, other)) as IaDoc).keys()) known.add(id);
  }
  const feeds = feedsIndex([...(agent === "director" ? foundry : directorIa()).slots.values()].map(slot => [slot.id, slot.feeds] as const), known);
  const writes: [string, string][] = [[iaFile, jsonBytes(foundry.ia)]];
  const dangling: string[] = [];
  // One format (foundry-build-0048 U13): the adoption writes every slot.json as clossys.slot/2, the same file `ia sync`
  // writes for a newly adopted leaf (structure, derived refs, the package behaviour and kind); never a clossys.slot/1.
  const at = toIsoZ(new Date().toISOString())!;
  const made = adoptedCurrentSlots(consumer, agent as SyncAgent, foundry, { known, feeds }, { at, version: cliActor("clossys ia").version, cli: "clossys ia --adopt" });
  for (const { id, slot, dropped } of made) {
    const file = slotFile(slotDir(consumer, agent as SlotAgent, id));
    if (modelExists(file)) return refuse("ia", `clossys/agents/${agent}/${id}/slot.json exists with no ${agent} ia.json; place it with --under or remove it first`);
    for (const ref of dropped) dangling.push(`${id} -> ${ref}`);
    if (!slot) return refuse("ia", `${agent}/${id}: the package slot has no clossys.slot/2 kind`);
    const issues = slotReadIssues(slot, file);
    if (issues.length) return refuse("ia", `${agent}/${id}: ${issues.map(issue => issue.message).join("; ")}`);
    writes.push([file, serializeSlot(slot)]);
  }
  // A declared ref that names no slot is a dangling edge: refuse it rather than leave it out of the read graph.
  if (dangling.length) return refuse("ia", `${agent}: ${dangling.length} declared refs name no slot (dangling edges): ${dangling.slice(0, 8).join(", ")}${dangling.length > 8 ? ", ..." : ""}`);
  // SLOT-CREATE (G19): the adoption records each placed slot's reuse-or-create decision with the overlaps found over the
  // agent's placed slots, as a placement does (runIa) and `clossys migrate placement` backfills.
  const decisions = new Map<string, Record<string, unknown>>();
  if (isContentAgent(agent)) {
    const positions = slotPositions(agent as SlotAgent, foundry.ia);
    for (const { id, slot } of made) {
      const at = positions.get(id)!, pkg = foundry.slots.get(id)!;
      decisions.set(`${agent}/${id}`, { decision: "create", overlaps: placementOverlaps(consumer, agent, { slot: id, kind: String(slot!.kind), l1: at.l1, l2: at.l2, inputs: pkg.declaredInputs, contract: pkg.contract }).map(overlap => ({ ...overlap })) });
    }
  }
  const slots = writes.length - 1;
  const skipped = whole.slots.size - foundry.slots.size;
  const left = skipped ? `; ${skipped} package leaves no publication reaches stay in the package (clossys request adopts one)` : "";
  const result = commitIa(consumer, root, writes, dry, `adopt the ${agent} IA from ${foundry.ia.source} (${foundry.ia.nodes.length} L1, ${slots} slots${left})`, [],
    `ia: adopted the ${agent} IA from ${foundry.ia.source} (${foundry.ia.nodes.length} L1, ${slots} slots with their contracts${left})`, {}, decisions);
  // The adoption writes clossys.slot/2 only: a store it leaves all current carries the marker (U13 r2).
  if (!dry && result.exitCode === 0) markCurrentStore(root, { at: new Date().toISOString(), version: cliActor("clossys ia").version, cli: "clossys ia --adopt" });
  // G20: the adopted slots change what the routing rows match, so the router re-derives the open entries' routes.
  if (dry || result.exitCode !== 0 || !isContentAgent(agent)) return result;
  const rerouted = rerouteOpenEntries(consumer, agent, at);
  return rerouted.length ? { ...result, message: `${result.message}\n  re-routed ${rerouted.length} open request${rerouted.length === 1 ? "" : "s"}: ${rerouted.join(", ")}` } : result;
}
/**
 * Who the re-run's ledger events name (CONSISTENCY fix r1, DECIDED D10): code. Which leaves leave is computed
 * (consumed.ts), not picked, so the decider is the verb itself, `code` as the runner records a code step, with the
 * cli and version that ran it; no person or agent is named for a choice nobody made.
 */
const PRUNE_ACTOR = "code";
/** The files of an adopted package leaf that carry no decision: its slot.json and its ledger. */
const UNDECIDED_FILES = new Set(["slot.json", LEDGER_FILE]);
/**
 * The adopt verb's re-run (CONSISTENCY D5 option 1): every placed package leaf no declared or seated publication
 * reaches (syncState unconsumed) leaves ia.json, with its slot.json and ledger, and the later slots renumber. Refused,
 * naming them, while such a leaf holds any other record (a pin, a candidate, a retired candidate) or another slot
 * refers to it. Nothing is retired: the leaf is package-verbatim and `clossys request` adopts it again.
 */
function pruneUnconsumed(agent: keyof typeof FOUNDRY_IA, consumer: string, root: string, iaFile: string, dry: boolean): CliResult {
  const gone = syncState(consumer, agent).unconsumed;
  if (!gone.length) return { exitCode: 0, root, message: `ia: ${agent} ia.json exists and places no package leaf that no publication reaches; nothing to remove (change it slot by slot: --under, --remove)` };
  const decided = gone.filter(id => {
    const dir = slotDir(consumer, agent, id);
    return listModelDir(dir).some(name => !UNDECIDED_FILES.has(name) && (isModelDir(join(dir, name)) ? holdsRecord(join(dir, name)) : modelExists(join(dir, name))));
  });
  if (decided.length) return refuse("ia", `${agent}: ${decided.length} unconsumed package leaves hold records, so they stay until those are retired: ${decided.slice(0, 8).join(", ")}${decided.length > 8 ? ", ..." : ""}`);
  const keys = new Set(gone.map(id => `${agent}/${id}`));
  const users: string[] = [];
  for (const [key, edges] of consumerGraph(root).forward) if (!keys.has(key)) for (const to of edges) if (keys.has(to)) users.push(`${key} -> ${to}`);
  if (users.length) return refuse("ia", `${agent}: other slots refer to unconsumed package leaves; change them first: ${users.slice(0, 8).join(", ")}${users.length > 8 ? ", ..." : ""}`);
  const ia = readModelJson(iaFile) as AgentIaFile;
  const goneIds = new Set(gone);
  const next = filterIa(ia as unknown as IaDoc, new Set(placedIdsOf(ia).filter(id => !goneIds.has(id)))) as unknown as AgentIaFile;
  const issues = validateIa(next, iaFile);
  if (issues.length) return refuse("ia", issues.map(issue => issue.message).join("; "));
  const follow = followPositions(consumer, agent, ia as unknown as IaFile, next as unknown as IaFile);
  if ("error" in follow) return refuse("ia", follow.error);
  const removed = gone.flatMap(id => [...UNDECIDED_FILES].map(name => join(slotDir(consumer, agent, id), name)).filter(modelExists));
  const rel = (path: string) => relative(root, path).split(sep).join("/");
  const summary = `took ${gone.length} package leaves no publication reaches out of the ${agent} IA${renumbered(follow)}`;
  if (dry) return { exitCode: 0, root, output: { dry: true, summary, removed: gone, writes: [iaFile, ...follow.writes.map(([file]) => file)].map(rel) }, message: [`ia --dry: ${summary}; wrote nothing`, ...gone.slice(0, 25).map(id => `  remove ${agent}/${id}`), ...(gone.length > 25 ? [`  ... and ${gone.length - 25} more`] : [])].join("\n") };
  const at = new Date().toISOString();
  const actor = cliActor("clossys ia --adopt");
  const ledgers = [join(agentDir(consumer, agent), LEDGER_FILE), ...follow.writes.map(([file]) => join(dirname(file), LEDGER_FILE))];
  const dirs = gone.map(id => slotDir(consumer, agent, id));
  const kinds = new Map(follow.writes.map(([file, bytes]) => [file, slotWriteKind(readModelText(file), bytes)]));
  const added = guarded(consumer, [iaFile, ...follow.writes.map(([file]) => file), ...ledgers, ...removed], () => {
    replaceFile(iaFile, jsonBytes(next));
    for (const [file, bytes] of follow.writes) {
      replaceFile(file, bytes);
      appendSlotDocEvent(consumer, agent, (JSON.parse(bytes) as { id: string }).id, { by: PRUNE_ACTOR, at, verb: "ia", skill: skillPath("producer", "ia"), fields: { kind: kinds.get(file)!, reason: "unconsumed package leaves left the IA", cli: actor.cli, version: actor.version } });
    }
    appendIaEvent(consumer, agent, { by: PRUNE_ACTOR, at, fields: { kind: IA_KIND, adopt: "prune-unconsumed", removed: gone, cli: actor.cli, version: actor.version } });
    for (const file of removed) removeModelFile(file);
    for (const dir of dirs) dropEmptyModelDir(dir);
  });
  if (added.length) return refuse("ia", `the slot model check fails after the removal: ${added.slice(0, 5).join("; ")}`);
  return { exitCode: 0, root, output: { removed: gone }, message: [`ia: ${summary} (clossys request adopts one again)`, ...followLines(follow).map(line => `  ${line}`), ...gone.slice(0, 25).map(id => `  removed ${agent}/${id}`), ...(gone.length > 25 ? [`  ... and ${gone.length - 25} more`] : [])].join("\n") };
}
const placedIdsOf = (ia: AgentIaFile): string[] => ia.nodes.flatMap(node => node.children.flatMap(child => child.slots));
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
    try { parsed = readJsonFile(resolve(cwd, value)); } catch (error) { return refuse("ia", `${op} ${value} is not a readable JSON file: ${errorMessage(error)}`); }
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
    try { contract = readJsonFile(resolve(cwd, contractFile)); } catch (error) { return refuse("ia", `--contract ${contractFile} is not a readable JSON file: ${errorMessage(error)}`); }
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
  // U13 one format: a seat slot is clossys.slot/2; a slot/1 seat is converted by clossys migrate slots, never rewritten.
  if (existing.schema !== SLOT_V2_SCHEMA) return refuse("ia", `${target} is a ${String(existing.schema)} slot; this verb writes clossys.slot/2 only: run clossys migrate slots --apply first`);
  const doc = { ...existing, ia: positionIa(slot, position), standard: standardId, contract } as unknown as Slot;
  // The reader's rules (schema plus the seat contract family), so a write never leaves a slot the reader refuses.
  const docIssues = slotReadIssues(doc, file);
  if (docIssues.length) return refuse("ia", docIssues.map(issue => issue.message).join("; "));
  const bytes = serializeSlot(doc);
  if (readModelText(file) === bytes) return { exitCode: 0, root, message: `ia: ${target} already names standard ${standardId}; nothing written` };
  return commitIa(consumer, root, [[file, bytes]], flags.bare.has("--dry"), `${target} standard ${standardId}${contractFile !== undefined ? " and contract" : ""}`, [], `ia: ${target} standard ${standardId} named (clossys/agents/${SEAT_AGENT}/${slot}/slot.json)`, iaWho(owner.ref, eventAt));
}
const rootConsumer = (cwd: string, flags: Flags) => join(rootOf(cwd, flags), "clossys");
const isRecordValue = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** `clossys ia sync [--check] [--agent <a>]`: the package IA against the consumer (foundry-feedback-0022). */
function runIaSync(flags: Flags, cwd: string): CliResult {
  const allowed = ["--agent", "--at", "--root"];
  const stray = [...[...flags.values.keys()].filter(flag => !allowed.includes(flag)), ...[...flags.bare].filter(flag => flag !== "--dry" && flag !== "--check")];
  if (stray.length || flags.positional.length > 1) throw new CliUsageError(`ia sync takes only --check, --agent, --at, --dry and --root\n${IA_USAGE}`);
  // A fixed --at stamps the slot.json and ledger writes, so a generated fixture replays byte for byte.
  const at = atOf(flags);
  const only = one(flags, "--agent");
  if (only !== undefined && !(SYNC_AGENTS as readonly string[]).includes(only)) throw new CliUsageError(`ia sync --agent takes one of ${SYNC_AGENTS.join(", ")}, got ${only}\n${IA_USAGE}`);
  const agents = (only === undefined ? SYNC_AGENTS : [only]) as SyncAgent[];
  const root = rootOf(cwd, flags), consumer = join(root, "clossys");
  // One finding function and one exit code for both paths (CONSISTENCY C1): a seat that waits on its decision is
  // listed as seat-pending and fails neither; every other finding fails --check, and fails the write while it remains.
  const before = syncVerdict(consumer, agents, only === undefined);
  const { findings, repairs } = before;
  const report = (verdict: SyncVerdict) => {
    const counts = Object.fromEntries(agents.map(agent => [agent, driftCounts(verdict.findings.filter(finding => finding.agent === agent))]));
    const summary = [...agents.map(agent => {
      const entries = Object.entries(counts[agent]!);
      return `${agent}: ${entries.length ? entries.map(([kind, n]) => `${n} ${kind}`).join(", ") : "in sync"}`;
    }), ...verdict.repairs.map(repair => `${repair.agent}: 1 source (workspace-owned)`)];
    const ordered = [...verdict.failing, ...verdict.pending];
    const listed = [...ordered.map(finding => `  ${finding.agent} ${finding.kind}: ${finding.detail}`), ...verdict.repairs.map(repair => `  ${repair.agent} source: ${repair.detail}`)].slice(0, 60);
    const drift = verdict.failing.length + verdict.repairs.length;
    // Each pending kind is counted by its own name: an unconsumed leaf is not a seat (CONSISTENCY fix r1).
    const seats = verdict.pending.filter(finding => finding.kind === "seat-pending").length;
    const unconsumed = verdict.pending.filter(finding => finding.kind === "unconsumed-leaf").length;
    const pendingHead = [
      ...(seats ? [`${seats} seat${seats === 1 ? "" : "s"} pending`] : []),
      ...(unconsumed ? [`${unconsumed} unconsumed package ${unconsumed === 1 ? "leaf" : "leaves"} (ia.orphans judges ${unconsumed === 1 ? "it" : "them"}; clossys ia <agent> --adopt takes ${unconsumed === 1 ? "it" : "them"} out)`] : []),
    ];
    const head = `${drift ? `${drift} drift finding${drift === 1 ? "" : "s"}` : "in sync with the package IA"}${pendingHead.length ? `; ${pendingHead.join(", ")} (listed, not failing)` : ""}`;
    return { counts, drift, head, lines: [...summary.map(line => `  ${line}`), ...listed, ...(ordered.length > 60 ? [`  ... and ${ordered.length - 60} more`] : [])] };
  };
  if (flags.bare.has("--check")) {
    const shown = report(before);
    return {
      exitCode: before.exitCode, root, check: true,
      output: { drift: shown.drift, counts: shown.counts, findings, pending: before.pending.length, workspaceSources: repairs.map(({ agent, detail }) => ({ agent, detail })) },
      message: [`ia sync --check: ${shown.head}`, ...shown.lines].join("\n"),
    };
  }
  // The write: per agent, the sync plan (ia.json and the changed slot.json files); an undeclared leaf refuses the whole sync.
  const writes: [string, string][] = [];
  const moves: SeatRetire[] = [];
  const lines: string[] = [];
  for (const agent of agents) {
    const state = syncState(consumer, agent);
    const plan = syncPlan(consumer, agent, knownSlots(consumer, agent, state), state, { at: at as Iso, version: cliActor("clossys ia sync").version, cli: "clossys ia sync" });
    if ("error" in plan) {
      // A store still on the old trees places the retired leaves as undeclared: the recut, not an extension, moves them.
      const recut = state.undeclared.length > 0 ? recutStore(root) : true;
      if (typeof recut === "object") return refuse("ia", `sync refused: ${plan.error}; the store format cannot be judged: ${recut.error}`);
      const hint = !recut ? "this store is not recut to the current trees: run clossys migrate recut first" : "declare them as extensions or upstream them into the package first";
      return refuse("ia", `sync refused: ${plan.error}; ${hint}`);
    }
    for (const [path, bytes] of plan.writes) {
      if (path.endsWith("slot.json")) {
        // Either format, as the reader judges it: a recut store's slot.json is a clossys.slot/2.
        const issues = slotReadIssues(JSON.parse(bytes), path);
        if (issues.length) return refuse("ia", `sync refused: ${relative(root, path)}: ${issues.map(issue => issue.message).join("; ")}`);
      }
    }
    writes.push(...plan.writes);
    moves.push(...plan.retired);
    const retiredIds = state.retiring;
    lines.push(`${agent}: ${plan.writes.length} file${plan.writes.length === 1 ? "" : "s"}${plan.adopted.length ? `, adopted ${plan.adopted.join(", ")}` : ""}${retiredIds.length ? `, retired ${retiredIds.join(", ")} (the package defines no such step; agents/${agent}/${RETIRED_SEATS_DIR}/)` : ""}`);
  }
  for (const repair of repairs) {
    writes.push([repair.path, repair.bytes]);
    lines.push(`${repair.agent}: 1 file, source repointed to the workspace-owned IA`);
  }
  const dry = flags.bare.has("--dry");
  if (!writes.length) {
    const shown = report(before);
    return { exitCode: before.exitCode, root, message: [`ia sync: nothing written; ${shown.head}`, ...shown.lines].join("\n") };
  }
  const result = commitIa(consumer, root, writes, dry, `sync ${agents.join(", ")} from the package IA (${before.failing.length + repairs.length} drift finding${before.failing.length + repairs.length === 1 ? "" : "s"})`, lines, undefined, { at }, undefined, moves);
  if (result.exitCode !== 0) return result;
  if (dry) {
    // Nothing is written: the findings no planned file repairs are the ones the write would leave.
    const planned = new Set([...writes.map(([path]) => path), ...moves.map(move => slotFile(move.from))]);
    const left = before.failing.filter(finding => !planned.has(finding.slot === undefined ? iaPath(consumer, finding.agent) : slotFile(slotDir(consumer, finding.agent, finding.slot))));
    if (!left.length) return result;
    return { ...result, exitCode: 1, message: [result.message, `  ${left.length} drift finding${left.length === 1 ? "" : "s"} the write would not repair:`, ...left.slice(0, 60).map(finding => `  ${finding.agent} ${finding.kind}: ${finding.detail}`)].join("\n") };
  }
  const after = syncVerdict(consumer, agents, only === undefined);
  const shown = report(after);
  return { ...result, exitCode: after.exitCode, message: [result.message, `  after the write: ${shown.head}`, ...shown.lines].join("\n") };
}

/**
 * One format (U13 r2): every slot.json this verb writes is `clossys.slot/2` (a new slot is created as slot/2), and a
 * stored `clossys.slot/1` slot is refused, never rewritten.
 */
export async function runIaCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  // Which package leaves a publication consumes is read from the installed Publisher package: unreadable, the verb
  // refuses by name rather than judging an empty set (CONSISTENCY fix r1).
  try { return await runIa(argv, cwd); } catch (error) {
    if (error instanceof PublisherDataError) return refuse("ia", error.message);
    throw error;
  }
}
async function runIa(argv: readonly string[], cwd: string): Promise<CliResult> {
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
  if (flags.values.has("--publication")) {
    if (target !== "publisher" || extra.length || flags.bare.has("--remove") || flags.bare.has("--move") || [...flags.values.keys()].some(key => key !== "--publication" && key !== "--root")) throw new CliUsageError(`ia publisher --publication <pub> takes no other flag but --dry and --root\n${IA_USAGE}`);
    return publicationIa(one(flags, "--publication")!, rootOf(cwd, flags), dry);
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
  // SLOT-CREATE: --request <id> places the new leaf an open create decision proposes (its L2, kind and contract), then closes it.
  const requestId = one(flags, "--request");
  let request: SlotRequest | undefined;
  if (requestId !== undefined) {
    try { request = readRequest(consumer, requestId); } catch (error) { if (error instanceof RequestError) return refuse("ia", error.message); throw error; }
    const proposed = targetOf(request);
    if (request.status !== "open" || request.decision !== "create" || !request.proposal) return refuse("ia", `--request ${requestId} is not an open create decision (clossys request ${requestId} --decide create ...)`);
    if (proposed?.agent !== agent || request.proposal.slot !== slot) return refuse("ia", `--request ${requestId} proposes ${proposed?.agent}/${request.proposal.slot}, not ${target}`);
  }
  // The owner's signature on the new leaf (loop.slot step sign): checked before anything is written.
  const approved = one(flags, "--approved");
  if (approved !== undefined) {
    if (!request) throw new CliUsageError(`--approved signs a request placement: ia ${target} --request <id> --approved queue.approve#<id>\n${IA_USAGE}`);
    const approval = signedApproval(consumer, approved, request);
    if ("error" in approval) return refuse("ia", approval.error);
  } else if (request && !flags.values.has("--owner-ref")) return refuse("ia", `--request ${request.id} places a new leaf, which takes the owner's signature: --approved queue.approve#<id> (loop.slot step sign) or a registered --owner-ref`);
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
  // REL-SLOT: a release slot is created here once, for an existing publication, as clossys.slot/2 kind release; a placed
  // release slot keeps its contract and standard rewrites (undefined: the write below runs as for any slot).
  const release = releasePlacement(consumer, root, ia, agent, slot, { kind: one(flags, "--kind"), under: flags.values.has("--under"), standard: standardId }, modelExists(slotFile(dir)));
  if (release && "error" in release) return refuse("ia", release.error);
  // --standard alone keeps the slot's written contract; otherwise the contract file is required.
  const fromRequest = request !== undefined && !flags.values.has("--contract");
  const contractFile = (standardId !== undefined && !flags.values.has("--contract")) || fromRequest ? undefined : need(flags, "--contract", IA_USAGE);
  let contract: unknown = fromRequest ? request!.proposal!.contract : undefined;
  if (contractFile !== undefined) { try { contract = readJsonFile(resolve(cwd, contractFile)); } catch (error) { return refuse("ia", `--contract ${contractFile} is not a readable JSON file: ${errorMessage(error)}`); } }
  const underFlag = one(flags, "--under") ?? request?.proposal?.under;
  if (request && placed) return refuse("ia", `${target} is already placed: close request ${request.id} with a reuse decision instead`);
  let next = ia;
  if (!placed) {
    const under = underFlag;
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
  } else if (underFlag) return refuse("ia", `${target} is already placed; --under only places a new slot`);
  // A slot placed before the end shifts every later slot's agent-wide order: their slot.json positions follow (order only).
  const follow = followPositions(consumer, agent, ia as unknown as IaFile, next as unknown as IaFile, undefined, slot);
  if ("error" in follow) return refuse("ia", follow.error);
  if (owner.ref) next = withChange(next, { op: placed ? "contract" : "place", ownerRef: owner.ref, at, detail: placed ? (contractFile === undefined ? `named the standard ${standardId} of ${slot}` : `wrote the contract of ${slot}`) : `placed ${slot} under ${underFlag}${renumbered(follow)}`, slotFiles: 1 + follow.writes.length });
  const iaIssues = validateIa(next, iaFile);
  if (iaIssues.length) return refuse("ia", iaIssues.map(issue => issue.message).join("; "));
  const position = slotPositions(agent, next as unknown as IaDoc).get(slot);
  if (!position) return refuse("ia", `${target} has no position in ${agent} ia.json`);
  const stored = modelExists(slotFile(dir)) ? readModelJson(slotFile(dir)) as Record<string, unknown> : undefined;
  // A recut store's slot.json is clossys.slot/2: its view (inputs and uses from refs, the kind family) is what this
  // write edits, and the file written back is slot/2 again (currentSlotWrite).
  const storedV2 = stored?.schema === SLOT_V2_SCHEMA && !validateSlot(stored).length ? stored as unknown as Slot : undefined;
  if (stored?.schema === SLOT_V2_SCHEMA && !storedV2) return refuse("ia", `${target} slot.json is not a valid ${SLOT_V2_SCHEMA}; clossys check names why`);
  // One format (U13): judged by the slot's own schema, never by what else the store holds. A new slot is created as
  // clossys.slot/2; an existing slot/1 (or any other schema) is refused, never rewritten in place.
  if (stored && !storedV2) return refuse("ia", oldSlotRefusal("ia", target).replace(/^ia refused: /, ""));
  // The view's option family is slot/2 data the slot/1 document does not hold: the write below carries it from the stored file.
  const existing = storedV2 ? (({ family: _family, ...view }) => view)(currentView(storedV2) as unknown as Record<string, unknown>) : stored;
  const proposedKind = request?.proposal?.kind;
  if (proposedKind !== undefined && !(AGENT_KIND[agent] as readonly string[]).includes(proposedKind)) return refuse("ia", `--request ${request!.id} proposes kind ${proposedKind}, not a ${agent} slot kind (${AGENT_KIND[agent].join(", ")})`);
  // A release slot is judged as its kind family (publication) until its clossys.slot/2 file is written as kind release.
  const kind = (release ? RELEASE_FAMILY : one(flags, "--kind") ?? proposedKind ?? (existing?.kind as string | undefined) ?? AGENT_KIND[agent][0]) as SlotKind;
  if (!(SLOT_KINDS as readonly string[]).includes(kind)) throw new CliUsageError(`--kind must be one of ${SLOT_KINDS.join(", ")}\n${IA_USAGE}`);
  if (contractFile === undefined && !fromRequest) {
    if (existing?.contract === undefined) return refuse("ia", `${target} has no written contract: --standard alone names the standard of a written slot (add --contract <file>)`);
    contract = existing.contract;
  }
  // SLOT-CREATE gate (spec L3): a content agent's new leaf's contract is valid for its kind family and names registered
  // requirements (a Producer seat contract is package data with no requirements key).
  // A placed slot's rewritten contract passes the same gate: an empty or wiped contract never replaces a valid one.
  if ((!placed || contractFile !== undefined) && isContentAgent(agent)) {
    const contractGate = placementContractIssues(kind, contract);
    if (contractGate.length) return refuse("ia", contractGate.join("; "));
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
    inputs: flags.values.has("--inputs") ? ids(one(flags, "--inputs")) : request?.proposal?.inputs ? request.proposal.inputs.map(ref => ref.slice(ref.indexOf("/") + 1)) : (existing?.inputs as string[] | undefined) ?? [],
    uses: flags.values.has("--uses") ? ids(one(flags, "--uses")) : (existing?.uses as string[] | undefined) ?? [],
  };
  const docIssues = validateSlotDoc(doc, slotFile(dir));
  if (docIssues.length) return refuse("ia", docIssues.map(issue => issue.message).join("; "));
  // SLOT-CREATE: placement runs the overlap check over the agent's placed slots and records the create decision.
  // A listed overlap stands only with a reason the owner signs: the request's decision (its overlap ids cover every one
  // found here) under --approved or --owner-ref, or --overlap-reason with --owner-ref on a direct placement.
  const overlaps = !placed && isContentAgent(agent) ? placementOverlaps(consumer, agent, { slot, kind, l1: position.l1, l2: position.l2, inputs: doc.inputs, contract }) : [];
  const directReason = one(flags, "--overlap-reason")?.trim();
  if (directReason !== undefined && (request || !owner.ref)) throw new CliUsageError(`--overlap-reason is the owner's reason on a direct placement: it takes --owner-ref and no --request (a request carries its decision's reason)\n${IA_USAGE}`);
  const overlapReason = request ? request.overlapReason : directReason || undefined;
  const covered = request ? overlaps.every(item => (request!.overlaps ?? []).some(listed => listed.slot === item.slot)) : true;
  if (overlaps.length && (!overlapReason || !covered)) return refuse("ia", overlapRefusal(target, overlaps, "clossys request <id> --decide reuse --slot <ref>"));
  const recorded = [...overlaps, ...((request?.overlaps ?? []).filter(listed => !overlaps.some(item => item.slot === listed.slot)))];
  let slotBytes = jsonBytes(doc);
  let missing: readonly { id: string; rel: "input" | "uses"; owner: string }[] = [];
  {
    const written = currentSlotWrite(root, doc as unknown as SlotV1, position, storedV2, {
      kind: release ? "release" : flags.values.has("--kind") ? undefined : storedV2?.kind, live: modelExists(pinFile(dir)), at: eventAt || new Date().toISOString(),
    });
    if ("error" in written) return refuse("ia", written.error);
    slotBytes = written.bytes;
    // A slotless input is a request to the agent that would hold it, never a refusal: the edge is linked when it closes.
    const unowned = written.missing.filter(item => !ownerOfNeed(consumer, item.id));
    if (unowned.length) return refuse("ia", `no consumer slot folder holds ${unowned.map(item => item.id).join(", ")}, and no agent holds its first id segment: raise it with clossys request --target <agent>/<slot> --from ${target} --why <text>`);
    missing = written.missing.map(item => ({ ...item, owner: ownerOfNeed(consumer, item.id)! }));
  }
  const writes: [string, string][] = [...(next !== ia ? [[iaFile, jsonBytes(next)] as [string, string]] : []), [slotFile(dir), slotBytes], ...follow.writes];
  const named = standardId !== undefined ? `, standard ${standardId} named` : "";
  const contractWritten = contractFile !== undefined || fromRequest;
  const what = !contractWritten ? `standard ${standardId} named` : `${placed ? "contract written" : `placed under ${underFlag} and its contract written`}${named}`;
  const summary = !contractWritten ? `${target} standard ${standardId}` : `${target} ${placed ? "contract" : `placed under ${underFlag} and contract`}${standardId !== undefined ? `, standard ${standardId}` : ""}`;
  const requestLines = missing.map(item => `${dry ? "would raise" : "raise"} a slot request to ${item.owner} for ${item.id} (${item.rel})`);
  const decision = placed ? new Map<string, Record<string, unknown>>() : new Map([[target, { decision: "create", overlaps: recorded, ...(recorded.length && overlapReason ? { overlapReason } : {}), ...(request ? { request: request.id } : {}) }]]);
  const committed = commitIa(consumer, root, writes, dry, summary, [...followLines(follow), ...requestLines], `ia: ${target} ${what} (clossys/agents/${agent}/${slot}/slot.json)`, iaWho(owner.ref ?? approved, eventAt), decision);
  if (committed.exitCode !== 0 || dry) return committed;
  const closeAt = toIsoZ(eventAt || new Date().toISOString()) ?? new Date().toISOString();
  const after: string[] = [];
  try {
    for (const item of missing) {
      // The slot just written names the need (cited): this write is the raise's requester edge.
      const raised = raiseRequest(consumer, { target: `${item.owner}/${item.id}`, from: target, rel: item.rel, why: `${target} names ${item.id} as ${item.rel === "input" ? "an input" : "a used slot"}; no slot holds it`, source: "ia", by: owner.ref ? "owner" : "planner", at: closeAt, ...(owner.ref ? { createdBy: { actor: "owner", ref: owner.ref } } : {}) }, { cited: true });
      after.push(`  request ${raised.request.id} ${raised.created ? "raised" : "already open"}: ${item.owner}/${item.id} for ${target}`);
    }
    if (request) {
      const closed = closeRequest(consumer, request.id, { by: owner.ref || approved !== undefined ? "owner" : "planner", at: closeAt, ...(approved !== undefined ? { approved } : {}), ...(owner.ref ? { ownerRef: owner.ref } : {}) });
      after.push(`  request ${request.id} closed: ${closed.request.from} linked to ${closed.request.link}`);
    }
  } catch (error) {
    if (error instanceof RequestError) return { exitCode: 1, root, message: [committed.message, `ia: placed, but the request step failed: ${error.message}`].join("\n") };
    throw error;
  }
  return after.length ? { ...committed, message: [committed.message, ...after].join("\n") } : committed;
}

/** The slot/1 kind family a release slot is judged as before it is written (records/request.ts KIND_FAMILY release). */
const RELEASE_FAMILY: SlotKind = "publication";
/** The one standard a release slot is judged by (packages/publisher/standards/release/). */
const RELEASE_STANDARD = "release";

/**
 * REL-SLOT: the release slot `publisher/release.<pub>` that `clossys publisher release <pub>` reads (release/paths.ts). It applies
 * to `--kind release` on any target and to any Publisher `release.<pub>` id (which the slot/2 reader takes as a release
 * slot whatever kind it declares): undefined for every other slot. The slot is created once, by the Publisher, for a
 * publication that exists (a placed `publisher/publication.<pub>` slot that is not retired, or a publisher ia.json
 * publication) and whose release slot id it is. Its candidates are the manifests the release engine writes.
 * The publication's own slot.json counts only when the slot reader takes it, it is not retired and it is placed in
 * publisher ia.json; an unreadable or invalid one refuses with its cause. A release slot is judged by the release standard only. Once its slot.json exists, a second create (`--kind release`
 * or `--under`) is refused; a contract or standard rewrite returns undefined and is written as for any placed slot.
 */
function releasePlacement(consumer: string, root: string, ia: AgentIaFile, agent: SlotAgent, slot: string, given: { readonly kind: string | undefined; readonly under: boolean; readonly standard: string | undefined }, exists: boolean): { publication: string } | { error: string } | undefined {
  const releaseId = RELEASE_SLOT.test(slot);
  const givenKind = given.kind;
  if (givenKind !== "release" && !(agent === "publisher" && releaseId)) return undefined;
  const target = `${agent}/${slot}`;
  if (agent !== "publisher") return { error: `${target}: a release slot is a Publisher slot, publisher/release.<publication>; ${agent} holds no release slot` };
  if (!releaseId) return { error: `${target}: a release slot id is release.<publication>, not ${slot}` };
  if (givenKind !== undefined && givenKind !== "release") return { error: `${target} is a release slot id: it takes --kind release, not ${givenKind}` };
  if (given.standard !== undefined && given.standard !== RELEASE_STANDARD) return { error: `${target} is a release slot: it is judged by --standard ${RELEASE_STANDARD}, not ${given.standard}` };
  if (exists) {
    if (givenKind !== undefined || given.under) return { error: `${target} already exists: a release slot is created once (its manifests are written by clossys publisher release ${publicationOf(root, slot)} --manifest; --contract or --standard alone rewrites it)` };
    return undefined;
  }
  const publication = publicationOf(root, slot);
  const listed = listedPublications(root).includes(publication);
  // A publication slot.json is evidence only when the slot reader takes it: an unreadable or invalid record refuses
  // with its cause, and a valid one counts only when it is not retired and is placed in publisher ia.json.
  const publicationId = `publication.${publication}`, publicationRef = `publisher/${publicationId}`;
  const publicationFile = slotFile(slotDir(consumer, "publisher", publicationId));
  let placed = false, unplacedWhy = "";
  if (modelExists(publicationFile)) {
    let record: unknown;
    try { record = readModelJson(publicationFile); } catch (error) { return { error: `${target}: ${publicationRef} slot.json does not read (${error instanceof Error ? error.message : String(error)}); a release slot belongs to an existing publication` }; }
    const issues = slotReadIssues(record, publicationFile);
    if (issues.length) return { error: `${target}: ${publicationRef} slot.json is not a valid slot (${issues.slice(0, 3).map(issue => issue.message).join("; ")}); a release slot belongs to an existing publication` };
    const retired = (record as { status?: unknown }).status === "retired", inIa = isPlaced(ia, publicationId);
    placed = !retired && inIa;
    unplacedWhy = retired ? `: ${publicationRef} is retired` : inIa ? "" : `: ${publicationRef} is not placed in publisher ia.json`;
  }
  if (!listed && !placed) return { error: `${target}: no publication ${publication} exists${unplacedWhy} (place ${publicationRef} first); a release slot belongs to an existing publication` };
  const named = releaseSlotId(root, publication);
  if (named !== slot) return { error: `${target}: publication ${publication} names its release slot publisher/${named} in publisher ia.json, not ${slot}` };
  return { publication };
}

/**
 * One present slot.json of a store-wide scan, parsed: a file that cannot be read or parsed is a broken record and comes
 * back as an error naming it, never as a slot of the other format or as no slot.
 */
function scannedSlot(root: string, file: string): { doc: Record<string, unknown> } | { error: string } {
  let doc: unknown;
  try { doc = JSON.parse(readModelText(file)); }
  catch (error) { return { error: `${relative(root, file)} cannot be read as JSON: ${errorMessage(error)}` }; }
  // A slot.json that parses to null, a list or a scalar is no slot of either format: named, never read as a slot/1.
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return { error: `${relative(root, file)} is not a JSON object (${doc === null ? "null" : Array.isArray(doc) ? "a list" : typeof doc})` };
  return { doc: doc as Record<string, unknown> };
}

/** True when the workspace holds a recut store: some slot.json under clossys/agents is `clossys.slot/2`. An unreadable one is an error. */
function recutStore(root: string): boolean | { error: string } {
  for (const folder of consumerSlotFolders(root)) {
    if (!folder.hasSlot) continue;
    const read = scannedSlot(root, folder.file);
    if ("error" in read) return read;
    if (read.doc.schema === SLOT_V2_SCHEMA) return true;
  }
  return false;
}

/**
 * The slot/2 kind a new slot takes when neither its id nor its contract names one (a slot the package tree does not
 * hold, such as an owner extension): the one kind the agent's `clossys.slot/2` slots under the same L1 hold. The L1
 * decides it, as the package trees do (Writer Voice, Prose and Copy; a Designer layer). None, or more than one, is none.
 */
function placedKind(root: string, agent: AgentId, l1: string): TargetSlotKind | undefined | { error: string } {
  const kinds = new Set<TargetSlotKind>();
  for (const folder of consumerSlotFolders(root)) {
    if (folder.agent !== agent || !folder.hasSlot) continue;
    // An unreadable sibling may hold the L1's kind: the kind is then unknown, and the write is refused naming the file.
    const read = scannedSlot(root, folder.file);
    if ("error" in read) return read;
    const doc = read.doc as Partial<Slot>;
    if (doc.schema === SLOT_V2_SCHEMA && doc.ia?.l1 === l1 && typeof doc.kind === "string") kinds.add(doc.kind);
  }
  return kinds.size === 1 ? [...kinds][0] : undefined;
}

/**
 * The `clossys.slot/2` bytes `clossys ia` writes on a recut store for the slot/1 document it built and validated:
 * the slot-1-to-2 mapping (slotFromV1), refs resolved to the agent whose folder holds each id (same agent first).
 * An existing slot/2 file keeps its createdBy, createdAt, status, base, brief (inputs follow the refs), tighten and
 * refs of other rels, and gains updatedAt; a new one is created by this verb, `live` when a pin is already there.
 */
function currentSlotWrite(root: string, doc: SlotV1, position: { l1: string; l2: string; order: number }, stored: Slot | undefined, options: { kind?: TargetSlotKind; live: boolean; at: string }): { bytes: string; missing: { id: string; rel: "input" | "uses" }[] } | { error: string } {
  const at = toIsoZ(options.at);
  if (!at) return { error: `--at ${options.at} is not an ISO timestamp` };
  const holders = new Map<string, AgentId[]>();
  for (const folder of consumerSlotFolders(root)) holders.set(folder.id, [...(holders.get(folder.id) ?? []), folder.agent]);
  const ia = positionIa(doc.id, position);
  // A Publisher --kind (page, publication) is itself a slot/2 kind, judged by validateSlot below.
  let kind = options.kind ?? targetKind(doc);
  if (kind === undefined) {
    const placed = placedKind(root, doc.agent, ia.l1);
    if (typeof placed === "object") return placed;
    kind = placed ?? (doc.agent === "publisher" ? doc.kind as TargetSlotKind : undefined);
  }
  if (!kind) return { error: `${doc.agent}/${doc.id} kind ${doc.kind} has no ${SLOT_V2_SCHEMA} kind` };
  // An id no consumer slot folder holds is left out of the refs and returned: the caller raises a slot request for it.
  const missing: { id: string; rel: "input" | "uses" }[] = [];
  // A bare id the stored slot already holds as keyed refs keeps those refs, key included (each once): --inputs and
  // --uses name ids, and a re-cut that keeps an id must not drop which part of it the slot reads.
  const kept = new Set<string>();
  const refsOf = (ids: readonly string[] | undefined, rel: "input" | "uses"): Ref[] => (ids ?? []).flatMap(id => {
    const agents = holders.get(id) ?? [];
    const agent = agents.includes(doc.agent) ? doc.agent : agents[0];
    if (!agent) { missing.push({ id, rel }); return []; }
    const to = `${agent}/${id}` as Ref["to"];
    const held = (stored?.refs ?? []).filter(ref => ref.rel === rel && ref.to === to);
    if (!held.some(ref => ref.key !== undefined)) return [{ to, rel }];
    if (kept.has(`${rel} ${to}`)) return [];
    kept.add(`${rel} ${to}`);
    return structuredClone(held);
  });
  const inputs = refsOf(doc.inputs, "input"), uses = refsOf(doc.uses, "uses");
  const made = slotFromV1(doc, { kind, status: stored?.status ?? (options.live ? "live" : "starter"), ia, inputs, uses, createdBy: stored?.createdBy ?? cliActor("clossys ia"), at: stored?.createdAt ?? at });
  const slot: Slot = !stored ? made : {
    ...made,
    updatedAt: at, base: stored.base, brief: { ...stored.brief, inputs: structuredClone(inputs) }, tighten: stored.tighten,
    refs: [...inputs, ...uses, ...stored.refs.filter(ref => ref.rel !== "input" && ref.rel !== "uses")],
    ...(made.options === undefined && stored.options !== undefined ? { options: stored.options } : {}),
    ...(made.varyOn === undefined && stored.varyOn !== undefined ? { varyOn: stored.varyOn } : {}),
    ...(stored.family !== undefined ? { family: stored.family } : {}),
  };
  const issues = validateSlot(slot);
  if (issues.length) return { error: `the ${SLOT_V2_SCHEMA} file would be invalid: ${issues.slice(0, 5).map(issue => `${issue.path} ${issue.message}`).join("; ")}` };
  return { bytes: serializeSlot(slot), missing };
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
  try { body = readFileSync(resolve(cwd, bodyFile), "utf8"); } catch (error) { return refuse("evidence", `cannot read --body ${bodyFile}: ${errorMessage(error)}`); }
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
    if (issues.length) return refuse("config", `${rel} exists and is invalid: ${issues.map(issue => issue.message).join("; ")}`);
    const flavor = writeFlavor(join(root, "clossys"));
    return { exitCode: 0, root, message: `config: ${rel} exists and is valid; ${flavor ? `wrote ${FLAVOR_FILE} (the Designer's shadcn flavor)` : "nothing written"}` };
  }
  let bytes = DEFAULT_CONFIG;
  const from = one(flags, "--from");
  if (from) { try { bytes = readFileSync(resolve(cwd, from), "utf8"); } catch (error) { return refuse("config", `cannot read --from ${from}: ${errorMessage(error)}`); } }
  const issues = validateFile("workspace-config", rel, bytes);
  if (issues.length) return refuse("config", issues.map(issue => issue.message).join("; "));
  replaceFile(file, bytes);
  // A fresh store is current from its first write (U13 r2): it carries the store-format marker, so its readers fail closed.
  const marked = markCurrentStore(root, { at: new Date().toISOString(), version: cliActor("clossys config").version, cli: "clossys config --init" });
  // The workspace's shadcn flavor, from the same writer the build uses (records/consumer-flavor.ts): code adopt and
  // ref-verbatim normalize stock items against it.
  const flavor = writeFlavor(join(root, "clossys"));
  return { exitCode: 0, root, message: `config: wrote ${rel}${from ? ` from ${from}` : " (default)"}${marked ? "; marked the store clossys.slot/2 (store-format.json)" : ""}; ${flavor ? `wrote ${FLAVOR_FILE} (the Designer's shadcn flavor)` : `${FLAVOR_FILE} unchanged`}` };
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
  // The round and stage labels are the package's authored ones (pipeline/seats.json, G8) where the package tree has
  // the round or stage; a round or stage it does not have keeps its id.
  const authored = readPipelineSeats().nodes.find(each => each.id === round);
  let node = nodes.find(each => each.id === round);
  if (!node) {
    node = { id: round, label: authored?.label ?? round, children: [] };
    const at = nodes.findIndex(each => rounds.indexOf(each.id) > rounds.indexOf(round));
    nodes.splice(at < 0 ? nodes.length : at, 0, node);
  }
  let child = node.children.find(each => each.id === step.stage);
  if (!child) {
    child = { id: step.stage, label: authored?.children.find(each => each.id === step.stage)?.label ?? step.stage, slots: [] };
    const at = node.children.findIndex(each => STAGES.indexOf(each.id as never) > STAGES.indexOf(step.stage));
    node.children.splice(at < 0 ? node.children.length : at, 0, child);
  }
  child.slots.push(id);
  // The seat tree's L0 layer and closed axes are package data (src/catalog/ia/levels.json), over the rounds placed so far.
  return { ...ia, nodes, ...packageLevels(PRODUCER_ROOT, nodes) };
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
    // U13: seats are clossys.slot/2 only; a slot/1 seat is converted by clossys migrate slots, never rewritten as slot/1.
    if (doc.schema !== SLOT_V2_SCHEMA) return { error: `producer/${id} is a ${String(doc.schema)} slot; run clossys migrate slots --apply first` };
    const ia = positionIa(id, at);
    if (jsonBytes(doc.ia) === jsonBytes(ia)) continue;
    const nextDoc = { ...doc, ia } as unknown as Slot;
    const issues = validateSlot(nextDoc);
    if (issues.length) return { error: `producer/${id}: ${issues.map(issue => `${issue.path} ${issue.message}`).join("; ")}` };
    writes.push([file, serializeSlot(nextDoc)]);
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
  // One format (foundry-build-0048 U13): a seat is a clossys.slot/2 of kind seat, a headered candidate and a
  // clossys.pin/2. An owner seat names the queue entry it answers (--decided-by owner:queue.<kind>#<id>); a planner
  // seat is planner[:<ref>]. A bare owner decider is refused: pin/2 records no owner basis without its answer.
  const decidedBy = one(flags, "--decided-by") ?? "owner";
  const answer = ownerAnswerRef(decidedBy);
  const planner = /^planner(:\S.*)?$/.test(decidedBy);
  if (!planner && !answer) throw new CliUsageError(`--decided-by must be owner:queue.<kind>#<id> (the queue entry the owner answered) or planner[:<ref>]\n${SEAT_USAGE}`);
  if (answer) {
    // An owner seat records only the owner's typed answer `seat` about producer/<seat slot> (records/owner-answer.ts, U13 r4 B2).
    const bound = ownerDecisionRefusal(root, decidedBy, { kind: "seat", slot: `${SEAT_AGENT}/${seatSlotId(id)}` });
    if (bound !== undefined) return refuse("seat", `--decided-by ${decidedBy}: ${bound}`);
  }
  const atZ = toIsoZ(one(flags, "--at") ?? new Date().toISOString());
  if (!atZ) throw new CliUsageError(`--at must be an ISO timestamp\n${SEAT_USAGE}`);
  const dir = seatDir(consumer, id);
  const slotId = seatSlotId(id);
  const docFile = slotFile(dir);
  const stored = modelExists(docFile) ? readModelJson(docFile) as Record<string, unknown> : undefined;
  if (stored && stored.schema !== SLOT_V2_SCHEMA) return refuse("seat", `producer/${slotId} is a ${String(stored.schema)} slot; this verb writes clossys.slot/2 and clossys.pin/2 only: run clossys migrate slots --apply first`);
  const heldPin = modelExists(pinFile(dir)) ? readPinFile(pinFile(dir), { agent: SEAT_AGENT, slotId }) : undefined;
  if (heldPin && heldPin.kind !== "pin") return refuse("seat", `producer/${slotId}/pin.json is not a clossys.pin/2 (${heldPin.kind}); run clossys migrate slots --apply first`);
  // A seat candidate is named for its slot's leaf (the last dot segment of seat.<step>), like every
  // other candidate: seat.pick.designer's are designer-v<n>.json. The version counts every candidate
  // of the slot, retired ones too, so a number is never reused.
  const leaf = seatLeaf(id);
  const existing = [...listModelDir(candidatesDir(dir)), ...listModelDir(join(dir, RETIRED_DIR))].map(name => CANDIDATE_NAME.exec(name)).filter(match => match?.[1] === leaf).map(match => Number(match![2]));
  const name = `${leaf}-v${Math.max(0, ...existing) + 1}.json`;
  const createdBy = cliActor("clossys seat");
  let bytes: string;
  try {
    bytes = recutCandidateBytes(name, jsonBytes(seat), { agent: SEAT_AGENT, slotId, at: atZ, version: createdBy.version, sourceRef: `agents/${SEAT_AGENT}/${slotId}/candidates/${name}`, cli: "clossys seat" });
  } catch (error) { return refuse("seat", error instanceof Error ? error.message : String(error)); }
  const pin = buildPin({
    agent: SEAT_AGENT, slotId, record: { candidate: name, sha256: sha(bytes), decidedBy, basis: planner ? "planner" : "picked", at: atZ },
    refs: answer ? [answer] : [], createdBy, ...(heldPin?.kind === "pin" ? { previous: heldPin.doc } : {}),
  });
  const pinProblems = pinIssues(pin, { agent: SEAT_AGENT, slotId });
  if (pinProblems.length) return refuse("seat", pinProblems.join("; "));
  const iaFile = iaPath(consumer, "producer");
  const ia = modelExists(iaFile) ? readModelJson(iaFile) as Parameters<typeof placeSeat>[0] : { schema: IA_SCHEMA, source: PRODUCER_IA_SOURCE, extensions: [], nodes: [] };
  const placed = placeSeat(ia, step);
  const candidate = join(candidatesDir(dir), name);
  // A seat is a slot of kind seat (D5): its slot.json is written once, its contract the step (the sample seat is package data, pipeline/seats.json).
  let doc: Slot | undefined;
  if (!stored) {
    try { doc = seatSlot({ slotId, step: id, position: slotPositions("producer", placed as IaDoc).get(slotId)!, status: "starter", createdBy, at: atZ }); }
    catch (error) { return refuse("seat", error instanceof Error ? error.message : String(error)); }
  }
  // A seat placed before the end shifts every later seat's order: their slot.json positions follow in the same guarded write.
  const follow = seatPositionWrites(consumer, placed as IaDoc, slotId);
  if ("error" in follow) return refuse("seat", follow.error);
  // The seat's candidate, pin and their submit and pin ledger events land as one guarded decision (U13 r4 step 5, N1):
  // a guard refusal or a slot-model finding puts every file back.
  // Every record the seat places or creates (ia.json, its slot.json, later seats' renumbered slot.json) gets the ledger
  // event an ia write gives it (R14.1), as commitIa appends them; the targets are read before any file is written.
  const records: [string, string][] = [...(placed !== ia ? [[iaFile, jsonBytes(placed)] as [string, string]] : []), ...follow.writes];
  const targets = [...records, ...(doc ? [[docFile, serializeSlot(doc)] as [string, string]] : [])].map(([file, text]) => iaWriteTarget(consumer, file, text));
  const ledgers = [...new Set([...records.map(([file]) => file), ...(doc ? [docFile] : [])].map(file => join(dirname(file), LEDGER_FILE)))];
  let added: string[];
  try {
    added = guarded(consumer, [iaFile, candidate, pinFile(dir), join(dir, LEDGER_FILE), ...(doc ? [docFile] : []), ...follow.writes.map(([file]) => file), ...ledgers], () => {
      for (const [file, text] of records) replaceFile(file, text);
      if (doc) createModelFile(docFile, serializeSlot(doc));
      for (const target of targets) {
        if (target.slot === undefined) appendIaEvent(consumer, target.agent, { by: decidedBy, at: atZ, fields: { kind: target.kind } });
        else appendSlotDocEvent(consumer, target.agent, target.slot, { by: decidedBy, at: atZ, verb: "ia", skill: skillPath("producer", "ia"), fields: { kind: target.kind } });
      }
      writeSeatDecision(consumer, slotId, { name, bytes, pin: `${JSON.stringify(pin, null, 2)}\n`, at: atZ, seed: `@clossys/producer:pipeline/seats.json#${id}` });
    });
  } catch (error) { return refuse("seat", error instanceof Error ? error.message : String(error)); }
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
  try { quote = readFileSync(resolve(cwd, quoteFile), "utf8").replace(/\r?\n$/, ""); } catch (error) { return refuse("owner-decision", `cannot read --quote-file ${quoteFile}: ${errorMessage(error)}`); }
  if (!quote.trim() || /[\r\n]/.test(quote)) return refuse("owner-decision", "--quote-file holds the owner's words on one non-empty line");
  const date = one(flags, "--date") ?? new Date().toISOString().slice(0, 10);
  const root = rootOf(cwd, flags);
  const file = join(root, "clossys", OWNER_DECISIONS_FILE);
  let doc: { schema: string; decisions: OwnerDecision[] } = { schema: OWNER_DECISIONS_SCHEMA, decisions: [] };
  if (existsSync(file)) {
    let value: unknown;
    try { value = readJsonFile(file); } catch (error) { return refuse("owner-decision", `${rel} is not JSON: ${errorMessage(error)}`); }
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

/**
 * The retire actor guard (foundry-build-0048 U7 r3): `--by` is the slot's own seat (`agent:<agent>[.<role>]`) or a
 * resolved owner answer (`owner:queue.<kind>#<id>`, records/seat-owner.ts) about this slot, answered with its option
 * `retire` (U7 r4). Bare `owner`, `planner`, a foreign seat, another subject's or another option's answer and free text
 * are refused before anything is read, moved, renumbered or written.
 */
function retireRefusal(root: string, agent: SlotAgent, slot: string, by: string, candidate?: string | null): CliResult | undefined {
  const why = actorRefusal(root, by, agent, retireBinding(agent, slot, candidate));
  if (why !== undefined) return refuse("retire", why);
  // Bound to what it asked about, the answer is also single-use (U7 r5, blind2 B1): a retire record or a retire
  // ledger event that already cites it refuses it.
  if (candidate === undefined) return undefined;
  const uses = retireAnswerUses(join(root, "clossys"), agent, by, { records: true });
  return uses.length ? refuse("retire", `--by ${by} already retired (${uses.slice(0, 3).join("; ")}); an owner's retire answer is used once`) : undefined;
}

function retireCandidate(consumer: string, root: string, agent: SlotAgent, slot: string, candidateId: string, fields: RetireFields): CliResult {
  const guard = retireRefusal(root, agent, slot, fields.by);
  if (guard) return guard;
  const target = `${agent}/${slot}`;
  const entry = readSlotEntry(consumer, agent, slot);
  if (!entry) return refuse("retire", `unknown slot ${target} (not in ${agent} ia.json)`);
  const candidate = resolveCandidate(entry.candidates, candidateId);
  // The owner's answer names this very candidate, and retired nothing before (U7 r5): judged before anything moves.
  const bound = candidate ? retireRefusal(root, agent, slot, fields.by, candidate) : undefined;
  if (bound) return bound;
  if (!candidate) return refuse("retire", `${target} has no candidate ${candidateId}`);
  // A present pin.json is the slot's pin whatever its state: one that does not parse, or parses but is no pin this
  // store reads (it fails the pin schema, or is a pin/1 in a converted store), may pin this candidate, so the retire
  // is refused naming it, never read as no pin. A valid pin is judged on every record it pins (each record of a pin
  // map, not only the first), each record's candidate resolved as `clossys pin` resolves a candidate id.
  const pinText = readSlotRecordText(entry.dir, "pin.json");
  if (pinText !== undefined) {
    const pinRel = `clossys/agents/${agent}/${slot}/pin.json`;
    let pinValue: unknown;
    try { pinValue = JSON.parse(pinText); }
    catch (error) { return refuse("retire", `${pinRel} cannot be read as JSON (${errorMessage(error)}); it may pin ${candidate}: repair the pin first`); }
    if (!entry.pin) {
      const issues = validatePin(pinValue, pinRel).map(issue => issue.message);
      // A schema-valid pin map with no records pins nothing: the slot reads as an invalid pin, and the refusal says why.
      if (!issues.length && !pinRecords(pinValue).length) return refuse("retire", `${pinRel} is a pin map that pins no record (its records are empty), so ${target} reads as an invalid pin: repair or remove the pin first`);
      return refuse("retire", `${pinRel} is not a valid pin (${issues.length ? issues.join("; ") : "a pin format this store no longer reads"}); it may pin ${candidate}: repair the pin first`);
    }
    const pinned = pinRecords(pinValue).map(record => resolveCandidate(entry.candidates, record.candidate) ?? record.candidate);
    if (pinned.includes(candidate)) return refuse("retire", `${candidate} is the pinned candidate of ${target}; repin first (clossys pin ${target} <candidate>)`);
  }
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
  const guard = retireRefusal(root, agent, slot, fields.by, null);
  if (guard) return guard;
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
  // A slot counts as pinned when its pin.json is present, valid or not: a pin that no longer validates may still pin
  // the slot. A pinned slot whose slot.json cannot be read may take the target as an input, so the guard refuses
  // naming it; it never passes the guard by skipping the slot.
  for (const other of SLOT_AGENTS) for (const entry of listSlots(consumer, other)) {
    if (other === agent && entry.id === slot) continue;
    if (!entry.pin && readSlotRecordText(entry.dir, "pin.json") === undefined) continue;
    let inputs: readonly string[];
    try { inputs = readSlot(consumer, other, entry.id).inputs; }
    catch (error) { return refuse("retire", `cannot read pinned slot ${other}/${entry.id} to find whether it takes ${target} as an input: ${errorMessage(error)}`); }
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
  // Positions number slots across the whole agent IA: every slot after the retired one moves up, so its slot.json
  // follows in its own format: a clossys.slot/1 ia is the position itself, a clossys.slot/2 ia the slash-path
  // positionIa of it, rewritten and validated as slot/2 (as `ia --remove` renumbers).
  const was = slotPositions(agent, ia as unknown as IaDoc), now = slotPositions(agent, next as unknown as IaDoc);
  const renumbered: [string, string][] = [];
  for (const [id, position] of now) {
    const file = slotFile(slotDir(consumer, agent, id));
    if (!modelExists(file)) continue;
    const doc = readModelJson(file) as Record<string, unknown> & { ia?: unknown };
    const v2 = doc.schema === SLOT_V2_SCHEMA;
    const want = v2 ? positionIa(id, position) : position, had = v2 ? positionIa(id, was.get(id)) : was.get(id);
    if (jsonBytes(doc.ia) === jsonBytes(want) || jsonBytes(doc.ia) !== jsonBytes(had)) continue;
    if (!v2) { renumbered.push([file, jsonBytes({ ...doc, ia: position })]); continue; }
    const moved = { ...doc, ia: want } as unknown as Slot;
    const invalid = validateSlot(moved);
    if (invalid.length) return refuse("retire", `${agent}/${id}: ${invalid.map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
    renumbered.push([file, serializeSlot(moved)]);
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
  // The folder move is an engine event of its own: the slot's logged records named gone at the old path and present
  // under _retired/, so `clossys check --engine` finds no logged record missing.
  if (folder) logSlotFolderMove(consumer, agent, slot, to, fields.by);
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
  const by = need(flags, "--by", RETIRE_USAGE);
  const root = rootOf(cwd, flags), consumer = join(root, "clossys");
  // The actor guard runs first, right after the flags parse: a refused actor learns nothing else and nothing is read.
  const refused = retireRefusal(root, agent, slot, by);
  if (refused) return refused;
  const reason = need(flags, "--reason", RETIRE_USAGE);
  if (/[\r\n]/.test(by) || /[\r\n]/.test(reason)) return refuse("retire", "--by and --reason are one line each");
  if (!RETIRE_REASON.test(reason)) throw new CliUsageError(`--reason must be a retire code (${RETIRE_CODES.join(", ")}), optionally followed by ": <note>", got ${reason}\n${RETIRE_USAGE}`);
  const at = one(flags, "--at") ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) throw new CliUsageError(`--at must be an ISO timestamp\n${RETIRE_USAGE}`);
  return whole ? retireSlot(consumer, root, agent, slot, { by, reason, at }) : retireCandidate(consumer, root, agent, slot, candidate!, { by, reason, at });
}
