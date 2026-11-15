/**
 * `clossys migrate recut` (release2 ia-target system.md 6, 7, 14; ticket foundry-build-0024): moves an int2
 * consumer onto the recut slot trees of the installed packages.
 *
 * 1. Plan. Every consumer slot folder of the Director, Designer, Writer and Publisher is mapped through its
 *    package: an id the package tree places and `src/catalog/retired.json` does not list stays (live); a
 *    retired id whose `target` (or `replacedBy`) is a live leaf of the same agent moves there (move); any
 *    other retired id is retired: its folder goes to `agents/<agent>/_retired/<id>` (the `clossys retire
 *    --slot` place) with its bytes unchanged, and it leaves the agent ia.json, recorded in its `retired`
 *    list. An id in no tree and no retired.json is unknown: the run names it, exits 1 and writes nothing.
 *    Producer seat folders are not recut (seats become loop steps).
 * 2. Header. Every candidate of a live or target slot carries the clossys.candidate/1 header, created by
 *    `{actor: code, cli: clossys migrate recut}` (the migrated records' actor); an int2 header (Markdown
 *    front matter of `slot`/`source`/`reason`, the Designer JSON `meta`) is replaced, and the body is kept
 *    byte for byte (a JSON `content` value as is). A moved candidate keeps its name unless the target holds
 *    that name with other bytes; it then takes the next free version. Each rewritten file is one `migrated`
 *    event (migration `recut`, old and new sha256 and blob ids) in `clossys/evidence/migrations.json`.
 * 3. Library. Each int2 library cell becomes one candidate in its slot's target (./library-cells.ts).
 * 4. Then slot-1-to-2, pin-1-to-2 and `ia sync` run over the result.
 *
 * Slot/1 `inputs` and `uses` naming a moved id are repointed to its target; a retired id is dropped from them.
 * A second `--apply` changes no byte.
 *
 * Nested layouts (foundry-build-0030): a slot folder is found by its slot.json at any depth below
 * `agents/<agent>/` and named by the slot.json `id`, not by its folder name. Folders above it are groups, not
 * ids. The plan first flattens each such folder to `agents/<agent>/<id>/` (the flat layout; grouping lives in
 * ia.json) and plans the rest on the flat paths, so a nested `--apply` writes what a flat one writes. A group
 * folder is removed once it is empty and never while it holds anything. A duplicate id at two places, a flat
 * place that exists, or a group folder holding anything but slot folders refuses the whole plan.
 *
 * A Publisher candidate that is a `clossys.page/1` record (the page record today's install and slot check
 * read) is passed through untouched: it already is the record, and the publisher ships no migration from it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { CANDIDATE_NAME, buildCandidateHeader, parseCandidateName, serializeCandidate, targetSchema } from "../records/candidate.js";
import { fileState, type FileState } from "../records/migrations.js";
import { parseYamlSubset, validateAgainst } from "../records/schema.js";
import { agentPackageRoot, packageVersion, writeSlot, SLOT_V1_SCHEMA } from "../records/slot.js";
import { RETIRE_SCHEMA, appendMigrationEvents, type RewrittenFile } from "../records/slot-write.js";
import { studioDesignerSlots } from "../records/slot-model/foundry-ia.js";
import { PAGE_SCHEMA } from "../records/slot-model/types.js";
import type { AgentId, CandidateHeader, Iso } from "../records/types.js";
import { planIaSync } from "../cli/ia-sync.js";
import { migratePins } from "./pin-1-to-2.js";
import { migrateSlot1To2, planSlot1To2 } from "./slot-1-to-2.js";
import { LIBRARY_DIR, planLibraryCells, removeLibraryCell, type CellRoute, type LibraryPlan } from "./library-cells.js";

export const RECUT = "recut";
export const RECUT_CLI = "clossys migrate recut";
export const RECUT_BY = `code:${RECUT_CLI}`;
/** Who an ia.json `retired` row names (clossys.retire/1 `by`: migration[:<name>]). */
export const RECUT_RETIRE_BY = `migration:${RECUT}`;
/** Where a retired slot folder goes: the `clossys retire --slot` place, a non-slot (`_`) folder of the agent. */
export const RETIRED_SLOTS = "_retired";
/** The agents whose packages ship a recut tree and a retired.json. */
export const RECUT_AGENTS = ["director", "designer", "writer", "publisher"] as const;
export type RecutAgent = (typeof RECUT_AGENTS)[number];
export type RecutFate = "live" | "move" | "retire" | "unknown";

/** One agent's package: its live leaf ids and its retired rows (id to the live target, if any). */
export interface PackageTable {
  readonly agent: RecutAgent;
  readonly live: ReadonlySet<string>;
  readonly retired: ReadonlyMap<string, string | undefined>;
  /** False when the package ships no src/catalog/retired.json. */
  readonly hasRetired: boolean;
}

export interface RecutRow { readonly agent: RecutAgent; readonly id: string; readonly fate: RecutFate; readonly target?: string }
export interface RecutCounts { live: number; moved: number; retired: number; unknown: number; headers: number; carried: number; cells: number; refs: number; flattened: number }
export interface CandidateChange {
  readonly agent: RecutAgent;
  readonly from: string;
  readonly to: string;
  /** Undefined when the target already holds these exact bytes (the move only removes the source). */
  readonly bytes: string | undefined;
  readonly fromState: FileState;
  readonly toState: FileState;
}
export interface FileWrite { readonly file: string; readonly bytes: string }
export interface FolderMove { readonly agent: RecutAgent; readonly id: string; readonly from: string; readonly to: string }
/** A slot folder found below a group folder (or under another name) and its flat place `agents/<agent>/<id>`. */
export interface FlattenMove { readonly agent: RecutAgent; readonly id: string; readonly from: string; readonly to: string }

export interface RecutPlan {
  readonly dir: string;
  readonly consumer: string;
  readonly at: Iso;
  readonly version: string;
  readonly rows: RecutRow[];
  /** `<agent>/<id>` of every unknown id: the run refuses while any remains. */
  readonly unknown: string[];
  /** Slot folders that move to their flat place before every other write; the rest of the plan names flat paths. */
  readonly flatten: FlattenMove[];
  /** `<agent>/<id>: duplicate slot id at <places>`: an id whose slot.json sits in two folders (refused). */
  readonly duplicates: string[];
  /** Packages that ship no retired.json although the consumer holds an id their tree does not place (a STOP). */
  readonly missingRetired: string[];
  readonly candidates: CandidateChange[];
  readonly slotRefs: FileWrite[];
  readonly folders: FolderMove[];
  readonly ia: FileWrite[];
  readonly library: LibraryPlan;
  readonly findings: string[];
  readonly skipped: string[];
  readonly counts: Record<RecutAgent, RecutCounts>;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const jsonBytes = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const posix = (from: string, to: string) => relative(from, to).split(sep).join("/");
const isDir = (path: string) => existsSync(path) && statSync(path).isDirectory();

function collectLeaves(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) { for (const item of node) collectLeaves(item, out); return; }
  if (!object(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "leaves" && Array.isArray(value)) {
      for (const leaf of value) {
        if (typeof leaf === "string") out.add(leaf);
        else if (object(leaf) && typeof leaf.id === "string") out.add(leaf.id);
      }
    } else collectLeaves(value, out);
  }
}

/** The recut tables of the installed packages that `dir` resolves. */
export function packageTables(dir: string): Record<RecutAgent, PackageTable> {
  const tables = {} as Record<RecutAgent, PackageTable>;
  for (const agent of RECUT_AGENTS) {
    const root = agentPackageRoot(dir, agent);
    const placed = new Set<string>();
    const iaDir = join(root, "src", "catalog", "ia");
    if (isDir(iaDir)) for (const file of readdirSync(iaDir).filter(name => name.endsWith(".json")).sort()) {
      collectLeaves(JSON.parse(readFileSync(join(iaDir, file), "utf8")), placed);
    }
    // Producer's Studio publication defines Designer package leaves on top of the Designer catalog.
    if (agent === "designer") for (const slot of studioDesignerSlots()) placed.add(slot.id);
    const retiredFile = join(root, "src", "catalog", "retired.json");
    const rows: unknown[] = existsSync(retiredFile) ? JSON.parse(readFileSync(retiredFile, "utf8")) as unknown[] : [];
    const retiredIds = new Set(rows.flatMap(row => (object(row) && typeof row.id === "string" ? [row.id] : [])));
    const live = new Set([...placed].filter(id => !retiredIds.has(id)));
    const targetOf = new Map<string, string | undefined>();
    for (const row of rows) if (object(row) && typeof row.id === "string") {
      const named = typeof row.target === "string" ? row.target : typeof row.replacedBy === "string" ? row.replacedBy : undefined;
      targetOf.set(row.id, named);
    }
    const retired = new Map<string, string | undefined>();
    for (const id of retiredIds) {
      // Follow a target that was itself retired, to the live leaf it ends on.
      let target = targetOf.get(id);
      const seen = new Set([id]);
      while (target !== undefined && !live.has(target) && targetOf.has(target) && !seen.has(target)) { seen.add(target); target = targetOf.get(target); }
      retired.set(id, target !== undefined && live.has(target) ? target : undefined);
    }
    tables[agent] = { agent, live, retired, hasRetired: existsSync(retiredFile) };
  }
  return tables;
}

export function fateOf(table: PackageTable, id: string): { fate: RecutFate; target?: string } {
  if (table.live.has(id)) return { fate: "live" };
  if (table.retired.has(id)) {
    const target = table.retired.get(id);
    return target === undefined ? { fate: "retire" } : { fate: "move", target };
  }
  return { fate: "unknown" };
}

// ---------------------------------------------------------------------------
// Candidate header
// ---------------------------------------------------------------------------

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const SVG_META = /<metadata[^>]*>([\s\S]*?)<\/metadata>/;
/** The int2 Markdown front matter keys (system.md 6.2: Director/Writer `slot` and `source`, and `reason`). */
const INT2_FRONT = new Set(["slot", "source", "reason"]);
const SOURCE_KINDS = new Set(["registry", "composition", "npm", "derived", "original", "package-default"]);

export interface HeaderContext {
  readonly agent: AgentId;
  readonly slotId: string;
  readonly at: Iso;
  readonly version: string;
  /** Where the bytes came from, relative to the consumer folder: the source ref of a derived header. */
  readonly sourceRef: string;
}

function sourceOf(value: unknown, fallback: string): CandidateHeader["source"] {
  if (object(value) && typeof value.kind === "string" && SOURCE_KINDS.has(value.kind) && Array.isArray(value.ref)
    && value.ref.every(ref => typeof ref === "string" && ref.length > 0)
    && Object.keys(value).every(key => key === "kind" || key === "ref" || (key === "license" && typeof value.license === "string" && value.license.length > 0))) {
    return structuredClone(value) as CandidateHeader["source"];
  }
  return { kind: "derived", ref: [fallback] };
}

function checked(header: CandidateHeader, name: string): CandidateHeader {
  const issues = validateAgainst(targetSchema("candidate"), header);
  if (issues.length) throw new Error(`${name}: the recut header is not a valid clossys.candidate/1: ${issues.slice(0, 3).map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
  return header;
}

/**
 * The bytes of a candidate under the recut: the existing candidate/1 header re-addressed to the slot it now
 * sits in, or a new one created by this command; the body is never changed.
 */
export function recutCandidateBytes(name: string, text: string, context: HeaderContext, int2?: { readonly source?: unknown }): string {
  const parts = parseCandidateName(name);
  if (!parts) throw new Error(`${name} is not a candidate file name (<name>-v<n>.md|json|svg)`);
  const id = `${context.agent}/${context.slotId}/${name}`;
  const slot = `${context.agent}/${context.slotId}`;
  const fresh = (source: CandidateHeader["source"]) => checked(buildCandidateHeader({
    agent: context.agent, slotId: context.slotId, name, status: "submitted",
    createdBy: { actor: "code", cli: RECUT_CLI, version: context.version }, createdAt: context.at, source,
  }), name);
  const readdressed = (header: Record<string, unknown>) => checked({ ...header, id, agent: context.agent, slot } as unknown as CandidateHeader, name);
  const current = (header: unknown) => object(header) && header.schema === "clossys.candidate/1" && header.id === id && header.slot === slot && header.agent === context.agent;

  if (parts.ext === "md") {
    const match = FRONT.exec(text);
    if (match) {
      const front = parseYamlSubset(match[1] ?? "");
      const body = text.slice(match[0].length);
      if (object(front) && "clossys" in front) {
        if (current(front.clossys)) return text;
        if (!object(front.clossys)) throw new Error(`${name}: the clossys front matter is not an object`);
        if (Object.keys(front).length > 1) throw new Error(`${name}: front matter holds keys beside clossys; not rewritten`);
        return serializeCandidate(name, readdressed(front.clossys), body);
      }
      if (object(front) && Object.keys(front).every(key => INT2_FRONT.has(key))) return serializeCandidate(name, fresh(sourceOf(front.source ?? int2?.source, context.sourceRef)), body);
    }
    return serializeCandidate(name, fresh(sourceOf(int2?.source, context.sourceRef)), text);
  }
  if (parts.ext === "json") {
    const doc = JSON.parse(text) as unknown;
    if (object(doc) && object(doc.clossys)) {
      if (Object.keys(doc).some(key => key !== "clossys" && key !== "content")) throw new Error(`${name}: holds keys beside clossys and content; not rewritten`);
      if (current(doc.clossys)) return text;
      return serializeCandidate(name, readdressed(doc.clossys), doc.content);
    }
    // A Publisher page record (clossys.page/1) is the record today's install and slot check read: kept as is.
    if (context.agent === "publisher" && object(doc) && doc.schema === PAGE_SCHEMA) return text;
    if (object(doc) && typeof doc.schema === "string") throw new Error(`${name}: a top-level schema key (${doc.schema}) is a record, not an int2 candidate`);
    let content: unknown = doc;
    let source: unknown = int2?.source;
    if (object(doc) && "meta" in doc) {
      const element = object(doc.meta) && object(doc.meta.element) ? doc.meta.element : undefined;
      source ??= element?.source;
      const rest = Object.fromEntries(Object.entries(doc).filter(([key]) => key !== "meta"));
      content = Object.keys(rest).length === 1 && "content" in rest ? rest.content : rest;
    } else if (object(doc) && Object.keys(doc).length === 1 && "content" in doc) content = doc.content;
    return serializeCandidate(name, fresh(sourceOf(source, context.sourceRef)), content);
  }
  const meta = SVG_META.exec(text);
  if (meta) {
    let value: unknown;
    try { value = JSON.parse(meta[1] ?? ""); } catch { throw new Error(`${name}: an SVG <metadata> that is not the clossys header; not rewritten`); }
    if (!object(value) || !object(value.clossys)) throw new Error(`${name}: an SVG <metadata> that is not the clossys header; not rewritten`);
    if (current(value.clossys)) return text;
    return text.replace(meta[0], `<metadata>${JSON.stringify({ clossys: readdressed(value.clossys) })}</metadata>`);
  }
  return serializeCandidate(name, fresh(sourceOf(int2?.source, context.sourceRef)), text);
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

const NOT_A_SLOT = /^(ia\.json|ledger\.json|views|queue\..+|ledger\..+|_.*)$/;

function slotFolders(consumer: string, agent: string): string[] {
  const dir = join(consumer, "agents", agent);
  if (!isDir(dir)) return [];
  return readdirSync(dir).filter(id => !NOT_A_SLOT.test(id) && isDir(join(dir, id))).sort();
}

const SLOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const hasSlotFile = (dir: string) => existsSync(join(dir, "slot.json"));
/** True when a slot.json sits in this folder or any folder below it. */
const holdsSlot = (dir: string): boolean => hasSlotFile(dir) || readdirSync(dir).some(name => isDir(join(dir, name)) && holdsSlot(join(dir, name)));

function slotJsonId(dir: string): string | undefined {
  try {
    const doc = JSON.parse(readFileSync(join(dir, "slot.json"), "utf8")) as unknown;
    return object(doc) && typeof doc.id === "string" && SLOT_ID.test(doc.id) && !NOT_A_SLOT.test(doc.id) ? doc.id : undefined;
  } catch { return undefined; }
}

export interface SlotDiscovery {
  /** Slot id to every folder holding its slot.json (one, unless duplicated), sorted. */
  readonly places: Map<string, string[]>;
  readonly findings: string[];
}

/**
 * The slot folders of one agent, at any depth: a folder holding slot.json is a slot folder named by its slot.json
 * id; a folder above one is a group (not an id) and must hold only slot folders and groups. A depth-1 folder with
 * no slot.json at or below it is the int2 slot its name gives (the flat layout before slot.json).
 */
export function discoverSlots(consumer: string, agent: string): SlotDiscovery {
  const root = join(consumer, "agents", agent);
  const places = new Map<string, string[]>();
  const findings: string[] = [];
  if (!isDir(root)) return { places, findings };
  const add = (id: string, dir: string) => places.set(id, [...(places.get(id) ?? []), dir]);
  const slot = (dir: string, fallback?: string) => {
    const id = slotJsonId(dir) ?? fallback;
    if (id === undefined) findings.push(`${posix(consumer, join(dir, "slot.json"))}: no slot id (an id of letters, digits, '.', '_' or '-'); not recut`);
    else add(id, dir);
  };
  const group = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (!isDir(path)) findings.push(`${posix(consumer, path)}: a group folder holds a file, not a slot folder; not flattened`);
      else if (hasSlotFile(path)) slot(path);
      else if (holdsSlot(path)) group(path);
      else findings.push(`${posix(consumer, path)}: a group folder holds a folder with no slot.json at or below it; not flattened`);
    }
  };
  for (const name of readdirSync(root).filter(entry => !NOT_A_SLOT.test(entry) && isDir(join(root, entry))).sort()) {
    const dir = join(root, name);
    if (hasSlotFile(dir)) slot(dir, name);
    else if (holdsSlot(dir)) group(dir);
    else add(name, dir);
  }
  for (const [id, dirs] of places) places.set(id, dirs.sort());
  return { places, findings };
}

/** A flat path of the plan to where it sits before the flatten moves run. */
export function placeOf(flatten: readonly FlattenMove[], path: string): string {
  for (const move of flatten) if (path === move.to || path.startsWith(move.to + sep)) return move.from + path.slice(move.to.length);
  return path;
}

function candidateFiles(slotDir: string): string[] {
  const dir = join(slotDir, "candidates");
  if (!isDir(dir)) return [];
  return readdirSync(dir).filter(name => !isDir(join(dir, name))).sort();
}

function nextFreeName(name: string, taken: (candidate: string) => boolean): string {
  const parts = parseCandidateName(name)!;
  let version = parts.version;
  let next = name;
  while (taken(next)) next = `${parts.name}-v${++version}.${parts.ext}`;
  return next;
}

/** One agent ia.json without the moved and retired ids, with each move's target placed where it was, and a `retired` row per retired folder. */
function recutIa(file: string, agent: RecutAgent, table: PackageTable, folders: readonly FolderMove[], at: Iso, unknown: string[], present: ReadonlySet<string>, real: (path: string) => string): FileWrite | undefined {
  // A moved or retired id stays placed while its folder stays (not every record of it moves).
  const stays = (id: string) => present.has(id) && !folders.some(folder => folder.agent === agent && folder.id === id);
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, "utf8");
  const doc = JSON.parse(text) as Record<string, unknown>;
  const placed = new Set<string>();
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  for (const node of nodes) if (object(node) && Array.isArray(node.children)) for (const child of node.children) {
    if (object(child) && Array.isArray(child.slots)) for (const id of child.slots) if (typeof id === "string") placed.add(id);
  }
  for (const id of placed) if (fateOf(table, id).fate === "unknown") unknown.push(`${agent}/${id}`);
  const next = structuredClone(doc);
  for (const node of (next.nodes as unknown[] | undefined) ?? []) if (object(node) && Array.isArray(node.children)) for (const child of node.children) {
    if (!object(child) || !Array.isArray(child.slots)) continue;
    child.slots = (child.slots as unknown[]).flatMap(id => {
      if (typeof id !== "string") return [id];
      const { fate, target } = fateOf(table, id);
      if ((fate === "move" || fate === "retire") && stays(id)) return [id];
      if (fate === "move" && target && !placed.has(target)) { placed.add(target); return [target]; }
      return fate === "move" || fate === "retire" ? [] : [id];
    });
  }
  if (Array.isArray(next.extensions)) next.extensions = (next.extensions as unknown[]).filter(id => typeof id !== "string" || fateOf(table, id).fate === "live" || stays(id));
  const history = Array.isArray(next.retired) ? next.retired as unknown[] : [];
  const recorded = new Set(history.flatMap(row => (object(row) && typeof row.slot === "string" ? [row.slot] : [])));
  const rows = folders.filter(folder => folder.agent === agent && !recorded.has(`${agent}/${folder.id}`)).map(folder => {
    const slotFile = real(join(folder.from, "slot.json"));
    const { target } = fateOf(table, folder.id);
    return {
      schema: RETIRE_SCHEMA, slot: `${agent}/${folder.id}`, sha256: existsSync(slotFile) ? fileState(readFileSync(slotFile)).sha256 : null, by: RECUT_RETIRE_BY,
      reason: target ? `superseded: recut, @clossys/${agent} retired.json moves it to ${agent}/${target}` : `not-needed: recut, @clossys/${agent} retired.json retires it`, at,
    };
  });
  if (rows.length) next.retired = [...history, ...rows];
  const bytes = jsonBytes(next);
  return bytes === text ? undefined : { file, bytes };
}

const emptyCounts = (): RecutCounts => ({ live: 0, moved: 0, retired: 0, unknown: 0, headers: 0, carried: 0, cells: 0, refs: 0, flattened: 0 });

/** What the recut would do under `dir` (the directory holding `clossys/`), without writing. */
export function planRecut(dir: string, options: { readonly at: Iso; readonly version?: string }): RecutPlan {
  const consumer = join(dir, "clossys");
  const version = options.version ?? packageVersion(dir, "producer");
  const tables = packageTables(dir);
  const counts = Object.fromEntries(RECUT_AGENTS.map(agent => [agent, emptyCounts()])) as Record<RecutAgent, RecutCounts>;
  const plan: RecutPlan = {
    dir, consumer, at: options.at, version, rows: [], unknown: [], flatten: [], duplicates: [], missingRetired: [], candidates: [], slotRefs: [], folders: [], ia: [],
    library: { conversions: [], findings: [] }, findings: [], skipped: slotFolders(consumer, "producer").map(id => `producer/${id}`), counts,
  };
  const planned = new Set<string>();
  const context = (agent: RecutAgent, slotId: string, sourceRef: string): HeaderContext => ({ agent, slotId, at: options.at, version, sourceRef });

  // Every slot folder, at any depth; a nested one (or one under another name) flattens to agents/<agent>/<id>.
  const ids = {} as Record<RecutAgent, string[]>;
  const present = {} as Record<RecutAgent, Set<string>>;
  for (const agent of RECUT_AGENTS) {
    const found = discoverSlots(consumer, agent);
    plan.findings.push(...found.findings);
    present[agent] = new Set(found.places.keys());
    ids[agent] = [];
    for (const id of [...found.places.keys()].sort()) {
      const places = found.places.get(id)!;
      if (places.length > 1) { plan.duplicates.push(`${agent}/${id}: duplicate slot id at ${places.map(place => posix(consumer, place)).join(", ")}`); continue; }
      ids[agent].push(id);
      const to = join(consumer, "agents", agent, id);
      if (places[0] !== to) { plan.flatten.push({ agent, id, from: places[0]!, to }); counts[agent].flattened++; }
    }
  }
  const real = (path: string) => placeOf(plan.flatten, path);

  for (const agent of RECUT_AGENTS) {
    const table = tables[agent];
    for (const id of ids[agent]) {
      const { fate, target } = fateOf(table, id);
      plan.rows.push({ agent, id, fate, ...(target ? { target } : {}) });
      const from = join(consumer, "agents", agent, id);
      if (fate === "unknown") {
        counts[agent].unknown++;
        plan.unknown.push(`${agent}/${id}`);
        if (!table.hasRetired && !plan.missingRetired.includes(`@clossys/${agent}`)) plan.missingRetired.push(`@clossys/${agent}`);
        continue;
      }
      if (fate === "retire") {
        counts[agent].retired++;
        const to = join(consumer, "agents", agent, RETIRED_SLOTS, id);
        if (existsSync(to)) { plan.findings.push(`${agent}/${id}: agents/${agent}/${RETIRED_SLOTS}/${id} exists; left in place`); continue; }
        plan.folders.push({ agent, id, from, to });
        continue;
      }
      const slotId = fate === "move" ? target! : id;
      const slotDir = join(consumer, "agents", agent, slotId);
      if (fate === "move") counts[agent].moved++; else counts[agent].live++;
      let ok = true;
      for (const name of candidateFiles(real(from))) {
        const file = join(from, "candidates", name);
        const sourceRef = posix(consumer, file);
        if (!CANDIDATE_NAME.test(name)) { plan.findings.push(`${sourceRef}: not a candidate file name; left in place`); ok = false; continue; }
        const original = readFileSync(real(file), "utf8");
        let targetName = name;
        let bytes: string;
        try { bytes = recutCandidateBytes(name, original, context(agent, slotId, sourceRef)); }
        catch (error) { plan.findings.push(`${sourceRef}: ${(error as Error).message}`); ok = false; continue; }
        if (fate === "live") {
          if (bytes === original) continue;
          counts[agent].headers++;
          plan.candidates.push({ agent, from: file, to: file, bytes, fromState: fileState(original), toState: fileState(bytes) });
          continue;
        }
        const at = (candidate: string) => join(slotDir, "candidates", candidate);
        const holds = (candidate: string, wanted: string) => existsSync(real(at(candidate))) && readFileSync(real(at(candidate)), "utf8") === wanted;
        if (holds(name, bytes)) {
          counts[agent].carried++;
          plan.candidates.push({ agent, from: file, to: at(name), bytes: undefined, fromState: fileState(original), toState: fileState(bytes) });
          continue;
        }
        if (existsSync(real(at(name))) || planned.has(at(name))) {
          targetName = nextFreeName(name, candidate => existsSync(real(at(candidate))) || planned.has(at(candidate)));
          bytes = recutCandidateBytes(targetName, original, context(agent, slotId, sourceRef));
        }
        planned.add(at(targetName));
        counts[agent].carried++;
        plan.candidates.push({ agent, from: file, to: at(targetName), bytes, fromState: fileState(original), toState: fileState(bytes) });
      }
      if (fate === "move") {
        const to = join(consumer, "agents", agent, RETIRED_SLOTS, id);
        if (!ok) plan.findings.push(`${agent}/${id}: not every candidate moves to ${agent}/${target}; the folder stays`);
        else if (existsSync(to)) plan.findings.push(`${agent}/${id}: agents/${agent}/${RETIRED_SLOTS}/${id} exists; left in place`);
        else plan.folders.push({ agent, id, from, to });
      }
    }
  }

  // Slot/1 inputs and uses: a moved id is repointed to its target, a retired id dropped.
  const anyFate = (id: string): { fate: RecutFate; target?: string } => {
    let found: { fate: RecutFate; target?: string } = { fate: "unknown" };
    for (const agent of RECUT_AGENTS) {
      const result = fateOf(tables[agent], id);
      if (result.fate === "live") return result;
      if (result.fate !== "unknown") found = result;
    }
    return found;
  };
  for (const row of plan.rows) {
    if (row.fate !== "live") continue;
    const file = join(consumer, "agents", row.agent, row.id, "slot.json");
    if (!existsSync(real(file))) continue;
    const text = readFileSync(real(file), "utf8");
    let doc: Record<string, unknown>;
    try { doc = JSON.parse(text) as Record<string, unknown>; } catch { continue; }
    if (doc.schema !== SLOT_V1_SCHEMA) continue;
    let changed = false;
    for (const key of ["inputs", "uses"] as const) {
      if (!Array.isArray(doc[key])) continue;
      const out: unknown[] = [];
      for (const id of doc[key] as unknown[]) {
        const result = typeof id === "string" ? anyFate(id) : { fate: "live" as const };
        const next = result.fate === "move" ? result.target : result.fate === "retire" ? undefined : id;
        if (next !== id) changed = true;
        if (next !== undefined && !out.includes(next)) out.push(next);
        else if (next !== undefined) changed = true;
      }
      doc[key] = out;
    }
    if (changed) { counts[row.agent].refs++; plan.slotRefs.push({ file, bytes: jsonBytes(doc) }); }
  }

  // Library cells, routed through the same table.
  const route = (slot: string): CellRoute => {
    const holders = RECUT_AGENTS.filter(agent => fateOf(tables[agent], slot).fate !== "unknown");
    const agent = holders.includes("designer") ? "designer" : holders[0];
    if (!agent) {
      plan.unknown.push(`${LIBRARY_DIR}/${slot}`);
      return { finding: `slot ${slot} is in no package tree and no retired.json` };
    }
    const { fate, target } = fateOf(tables[agent], slot);
    if (fate === "retire") {
      // The slot folder moves to _retired/<slot> before the cell lands there: its candidates are the clash set.
      const moving = plan.folders.find(folder => folder.agent === agent && folder.id === slot);
      return { agent, slotId: slot, dir: join(consumer, "agents", agent, RETIRED_SLOTS, slot), record: false, ...(moving ? { arriving: real(moving.from) } : {}) };
    }
    const slotId = fate === "move" ? target! : slot;
    return { agent, slotId, dir: join(consumer, "agents", agent, slotId), record: true };
  };
  const library = planLibraryCells(consumer, route, input => {
    const element = object(input.element) ? input.element : {};
    const license = object(element.license) && typeof element.license.spdx === "string" && element.license.spdx ? element.license.spdx : undefined;
    return recutCandidateBytes(input.name, input.body, context(input.agent as RecutAgent, input.slotId, input.sourceRef), {
      source: { kind: "derived", ref: [input.sourceRef], ...(license ? { license } : {}) },
    });
  }, planned);
  (plan as { library: LibraryPlan }).library = library;
  for (const conversion of library.conversions) counts[conversion.agent as RecutAgent].cells++;
  plan.findings.push(...library.findings);

  for (const agent of RECUT_AGENTS) {
    const write = recutIa(join(consumer, "agents", agent, "ia.json"), agent, tables[agent], plan.folders, options.at, plan.unknown, present[agent], real);
    if (write) plan.ia.push(write);
  }
  plan.unknown.splice(0, plan.unknown.length, ...[...new Set(plan.unknown)].sort());
  return plan;
}

/** The recut writes a plan holds (0 when the consumer is on the recut trees). */
export function recutPending(plan: RecutPlan): number {
  return plan.flatten.length + plan.candidates.length + plan.slotRefs.length + plan.folders.length + plan.ia.length + plan.library.conversions.length;
}

export interface FollowUp { slot1To2: number; slot1To2Findings: string[]; pins: number; pinRefused: string[]; iaSync: number; iaSyncFindings: string[] }

/** What slot-1-to-2, pin-1-to-2 and ia sync would still write. */
export function planFollowUp(dir: string, at: Iso, version: string): FollowUp {
  const slots = planSlot1To2(dir, { at, version });
  const pins = migratePins(dir, { dryRun: true });
  const sync = planIaSync(dir, at);
  return {
    slot1To2: slots.migrations.length, slot1To2Findings: slots.findings.map(finding => `${finding.subject}: ${finding.detail}`),
    pins: pins.rows.filter(row => row.outcome === "migrated").length, pinRefused: pins.rows.filter(row => row.outcome === "refused").map(row => row.slot),
    iaSync: sync.changes.length, iaSyncFindings: sync.findings,
  };
}

export interface RecutResult extends FollowUp { readonly written: number; readonly events: number }

const write = (file: string, bytes: string, flag?: "wx") => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes, flag ? { flag } : undefined); };
const dropEmpty = (dir: string) => { if (isDir(dir) && readdirSync(dir).length === 0) rmdirSync(dir); };

/**
 * Why a plan cannot apply whole: an unknown id, a finding, or a write that would land on a file (checked
 * against the tree as it stands after every earlier step, folder moves included). Empty when every write fits.
 */
export function recutProblems(plan: RecutPlan): string[] {
  const problems = [...plan.unknown.map(id => `unknown: ${id}`), ...plan.findings, ...plan.duplicates];
  const real = (path: string) => placeOf(plan.flatten, path);
  for (const move of plan.flatten) {
    if (!isDir(move.from)) problems.push(`${posix(plan.consumer, move.from)}: the folder to flatten is gone`);
    if (existsSync(move.to)) problems.push(`${posix(plan.consumer, move.to)}: the flatten move would land on one that exists with other bytes`);
  }
  const targets = new Set<string>();
  const after = (file: string): boolean => {
    if (existsSync(real(file)) || targets.has(file)) return true;
    for (const folder of plan.folders) if (file.startsWith(folder.to + sep) && existsSync(join(real(folder.from), file.slice(folder.to.length + 1)))) return true;
    return false;
  };
  const claim = (file: string) => {
    if (after(file)) problems.push(`${posix(plan.consumer, file)}: the write would land on a file that exists`);
    targets.add(file);
  };
  for (const change of plan.candidates) if (change.from !== change.to && change.bytes !== undefined) claim(change.to);
  for (const folder of plan.folders) {
    if (!isDir(real(folder.from))) problems.push(`${posix(plan.consumer, folder.from)}: the folder to move is gone`);
    if (existsSync(folder.to)) problems.push(`${posix(plan.consumer, folder.to)}: the folder move would land on one that exists`);
  }
  for (const conversion of plan.library.conversions) claim(conversion.file);
  return problems;
}

/**
 * Applies a plan whole or not at all: refuses (throws, nothing written) while recutProblems names anything.
 * Then runs slot-1-to-2, pin-1-to-2 and ia sync.
 */
export function applyRecut(plan: RecutPlan): RecutResult {
  if (plan.missingRetired.length) throw new Error(`STOP: ${plan.missingRetired.join(", ")} ship no src/catalog/retired.json row for ${plan.unknown.join(", ")}`);
  if (plan.unknown.length) throw new Error(`unknown slot ids (in no package tree and no retired.json): ${plan.unknown.join(", ")}`);
  const problems = recutProblems(plan);
  if (problems.length) throw new Error(`the recut does not apply whole; nothing written: ${problems.join("; ")}`);
  let written = 0;
  // Flatten first: every later write names the flat path. A group folder left empty is removed, up to the agent folder.
  for (const move of plan.flatten) {
    renameSync(move.from, move.to);
    written++;
    const top = join(plan.consumer, "agents", move.agent);
    for (let dir = dirname(move.from); dir.startsWith(top + sep) && isDir(dir) && readdirSync(dir).length === 0; dir = dirname(dir)) rmdirSync(dir);
  }
  const events: RewrittenFile[] = [];
  const record = (to: string, from: FileState, toState: FileState) => {
    const file = posix(plan.consumer, to);
    // A record kept byte for byte (a page record moved as is) is no rewrite: no migrated event.
    if (from.sha256 === toState.sha256) return;
    if (/^agents\/[a-z]+\/[^/_][^/]*\/candidates\/[^/]+$/.test(file)) events.push({ file, from, to: toState });
  };
  for (const change of plan.candidates) {
    if (change.from === change.to) { write(change.to, change.bytes!); written++; }
    else {
      if (change.bytes !== undefined) { write(change.to, change.bytes, "wx"); written++; }
      unlinkSync(change.from);
      dropEmpty(join(dirname(change.from)));
    }
    record(change.to, change.fromState, change.toState);
  }
  // Folders first: a retired slot's library cell lands in the folder once it has moved.
  for (const folder of plan.folders) {
    mkdirSync(dirname(folder.to), { recursive: true });
    renameSync(folder.from, folder.to);
    written++;
  }
  for (const conversion of plan.library.conversions) {
    write(conversion.file, conversion.bytes, "wx");
    written++;
    removeLibraryCell(plan.consumer, conversion.cell);
    if (conversion.record) record(conversion.file, conversion.from, fileState(conversion.bytes));
  }
  for (const file of [...plan.slotRefs, ...plan.ia]) { write(file.file, file.bytes); written++; }
  const added = events.length ? appendMigrationEvents(plan.consumer, RECUT, events, { by: RECUT_BY, at: plan.at }) : [];

  const slots = migrateSlot1To2(plan.dir, { at: plan.at, version: plan.version });
  const pins = migratePins(plan.dir);
  const sync = planIaSync(plan.dir, plan.at);
  let synced = 0;
  for (const change of sync.changes) if (writeSlot(change.file, change.slotDoc)) synced++;
  return {
    written, events: added.length,
    slot1To2: slots.written.length, slot1To2Findings: slots.findings.map(finding => `${finding.subject}: ${finding.detail}`),
    pins: pins.written, pinRefused: pins.rows.filter(row => row.outcome === "refused").map(row => row.slot),
    iaSync: synced, iaSyncFindings: sync.findings,
  };
}
