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
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { CANDIDATE_NAME, buildCandidateHeader, parseCandidateName, serializeCandidate, targetSchema } from "../records/candidate.js";
import { fileState, type FileState } from "../records/migrations.js";
import { parseYamlSubset, validateAgainst } from "../records/schema.js";
import { agentPackageRoot, packageVersion, writeSlot, SLOT_V1_SCHEMA } from "../records/slot.js";
import { RETIRE_SCHEMA, appendMigrationEvents, type RewrittenFile } from "../records/slot-write.js";
import { studioDesignerSlots } from "../records/slot-model/foundry-ia.js";
import type { AgentId, CandidateHeader, Iso } from "../records/types.js";
import { planIaSync } from "../cli/ia-sync.js";
import { migratePins } from "./pin-1-to-2.js";
import { migrateSlot1To2, planSlot1To2 } from "./slot-1-to-2.js";
import { planLibraryCells, removeLibraryCell, type CellRoute, type LibraryPlan } from "./library-cells.js";

export const RECUT = "recut";
export const RECUT_CLI = "clossys migrate recut";
export const RECUT_BY = `code:${RECUT_CLI}`;
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
export interface RecutCounts { live: number; moved: number; retired: number; unknown: number; headers: number; carried: number; cells: number; refs: number }
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

export interface RecutPlan {
  readonly dir: string;
  readonly consumer: string;
  readonly at: Iso;
  readonly version: string;
  readonly rows: RecutRow[];
  /** `<agent>/<id>` of every unknown id: the run refuses while any remains. */
  readonly unknown: string[];
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
function recutIa(file: string, agent: RecutAgent, table: PackageTable, folders: readonly FolderMove[], at: Iso, unknown: string[]): FileWrite | undefined {
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
      if (fate === "move" && target && !placed.has(target)) { placed.add(target); return [target]; }
      return fate === "move" || fate === "retire" ? [] : [id];
    });
  }
  if (Array.isArray(next.extensions)) next.extensions = (next.extensions as unknown[]).filter(id => typeof id !== "string" || fateOf(table, id).fate === "live");
  const history = Array.isArray(next.retired) ? next.retired as unknown[] : [];
  const recorded = new Set(history.flatMap(row => (object(row) && typeof row.slot === "string" ? [row.slot] : [])));
  const rows = folders.filter(folder => folder.agent === agent && !recorded.has(`${agent}/${folder.id}`)).map(folder => {
    const slotFile = join(folder.from, "slot.json");
    const { target } = fateOf(table, folder.id);
    return {
      schema: RETIRE_SCHEMA, slot: `${agent}/${folder.id}`, sha256: existsSync(slotFile) ? fileState(readFileSync(slotFile)).sha256 : null, by: RECUT_BY,
      reason: target ? `recut: @clossys/${agent} retired.json moves it to ${agent}/${target}` : `recut: @clossys/${agent} retired.json retires it`, at,
    };
  });
  if (rows.length) next.retired = [...history, ...rows];
  const bytes = jsonBytes(next);
  return bytes === text ? undefined : { file, bytes };
}

const emptyCounts = (): RecutCounts => ({ live: 0, moved: 0, retired: 0, unknown: 0, headers: 0, carried: 0, cells: 0, refs: 0 });

/** What the recut would do under `dir` (the directory holding `clossys/`), without writing. */
export function planRecut(dir: string, options: { readonly at: Iso; readonly version?: string }): RecutPlan {
  const consumer = join(dir, "clossys");
  const version = options.version ?? packageVersion(dir, "producer");
  const tables = packageTables(dir);
  const counts = Object.fromEntries(RECUT_AGENTS.map(agent => [agent, emptyCounts()])) as Record<RecutAgent, RecutCounts>;
  const plan: RecutPlan = {
    dir, consumer, at: options.at, version, rows: [], unknown: [], missingRetired: [], candidates: [], slotRefs: [], folders: [], ia: [],
    library: { conversions: [], findings: [] }, findings: [], skipped: slotFolders(consumer, "producer").map(id => `producer/${id}`), counts,
  };
  const planned = new Set<string>();
  const context = (agent: RecutAgent, slotId: string, sourceRef: string): HeaderContext => ({ agent, slotId, at: options.at, version, sourceRef });

  for (const agent of RECUT_AGENTS) {
    const table = tables[agent];
    for (const id of slotFolders(consumer, agent)) {
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
      for (const name of candidateFiles(from)) {
        const file = join(from, "candidates", name);
        const sourceRef = posix(consumer, file);
        if (!CANDIDATE_NAME.test(name)) { plan.findings.push(`${sourceRef}: not a candidate file name; left in place`); ok = false; continue; }
        const original = readFileSync(file, "utf8");
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
        const holds = (candidate: string, wanted: string) => existsSync(at(candidate)) && readFileSync(at(candidate), "utf8") === wanted;
        if (holds(name, bytes)) {
          counts[agent].carried++;
          plan.candidates.push({ agent, from: file, to: at(name), bytes: undefined, fromState: fileState(original), toState: fileState(bytes) });
          continue;
        }
        if (existsSync(at(name)) || planned.has(at(name))) {
          targetName = nextFreeName(name, candidate => existsSync(at(candidate)) || planned.has(at(candidate)));
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
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
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
    if (!agent) return { finding: `slot ${slot} is in no package tree and no retired.json` };
    const { fate, target } = fateOf(tables[agent], slot);
    if (fate === "retire") return { agent, slotId: slot, dir: join(consumer, "agents", agent, RETIRED_SLOTS, slot), record: false };
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
    const write = recutIa(join(consumer, "agents", agent, "ia.json"), agent, tables[agent], plan.folders, options.at, plan.unknown);
    if (write) plan.ia.push(write);
  }
  plan.unknown.splice(0, plan.unknown.length, ...[...new Set(plan.unknown)].sort());
  return plan;
}

/** The recut writes a plan holds (0 when the consumer is on the recut trees). */
export function recutPending(plan: RecutPlan): number {
  return plan.candidates.length + plan.slotRefs.length + plan.folders.length + plan.ia.length + plan.library.conversions.length;
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

/** Applies a plan: refuses (throws) while an id is unknown. Then runs slot-1-to-2, pin-1-to-2 and ia sync. */
export function applyRecut(plan: RecutPlan): RecutResult {
  if (plan.missingRetired.length) throw new Error(`STOP: ${plan.missingRetired.join(", ")} ship no src/catalog/retired.json row for ${plan.unknown.join(", ")}`);
  if (plan.unknown.length) throw new Error(`unknown slot ids (in no package tree and no retired.json): ${plan.unknown.join(", ")}`);
  let written = 0;
  const events: RewrittenFile[] = [];
  const record = (to: string, from: FileState, toState: FileState) => {
    const file = posix(plan.consumer, to);
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
