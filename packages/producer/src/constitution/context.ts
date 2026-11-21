/**
 * Builds the one `ConstitutionContext` a run judges: every agent tree read once, tolerantly, through
 * the slot-model reader (records/slots.ts). Nothing is validated here. A malformed ia.json, an
 * unparseable pin or an alien folder is kept as it is found, so the rules can report it; a reader
 * that refused bad records would hide exactly what the constitution exists to find.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { sha256Hex } from "../records/hash.js";
import { MIGRATIONS_FILE, validateMigrations, type MigrationsDoc } from "../records/migrations.js";
import { agentDir, candidatesDir, designerIa, directorIa, MODEL_AGENTS, writerIa, type FoundryIa, type ModelAgent } from "../records/slot-model/index.js";
import { isModelDir, isSlotFolderName, listModelDir, readModelBytes, withSlotReadScope } from "../records/slots.js";
import { readCandidateText } from "../records/slot-current.js";
import { skillFile } from "../records/ledger.js";
import { loadActions } from "../pipeline/actions.js";
import { readCandidateHistory } from "./git.js";
import type { AgentRecord, CandidateHistory, CandidateRecord, ConstitutionContext, FocusTarget, FoundryAgent, JsonRecord, MigrationsRecord, RetiredRecord, SlotRecord } from "./types.js";
import { AGENT_LOOPS } from "../loop/agent-loops-ia.js";

const posix = (path: string) => path.split(sep).join("/");
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Reads a model file as text (or the error that stopped the read). */
function readText(path: string): { text: string; bytes?: Buffer; error?: string } {
  try {
    const bytes = readModelBytes(path);
    return { text: bytes.toString("utf8"), bytes };
  } catch (error) { return { text: "", error: errorText(error) }; }
}

function readJsonRecord(abs: string, rel: string): JsonRecord {
  const read = readText(abs);
  if (read.error !== undefined) return { path: rel, text: "", error: read.error };
  const sha256 = sha256Hex(read.bytes!);
  try { return { path: rel, text: read.text, sha256, value: JSON.parse(read.text) as unknown }; }
  catch (error) { return { path: rel, text: read.text, sha256, error: `not JSON: ${errorText(error)}` }; }
}

/**
 * src/constitution/skill-hashes.json (scripts/generate-skill-hashes.mjs (not shipped)): every past state of every
 * action skill (`skills`) and of every plumb action's action.json (`actions`), by path.
 */
export function readSkillHashes(url: URL = new URL("../../src/constitution/skill-hashes.json", import.meta.url)): Map<string, Set<string>> {
  const known = new Map<string, Set<string>>();
  let value: unknown;
  try { value = JSON.parse(readFileSync(url, "utf8")); } catch { return known; }
  for (const key of ["skills", "actions"] as const) {
    const paths = (value as Record<string, unknown> | null)?.[key];
    if (!paths || typeof paths !== "object" || Array.isArray(paths)) continue;
    for (const [path, list] of Object.entries(paths as Record<string, unknown>)) {
      if (Array.isArray(list)) known.set(path, new Set(list.filter((sha): sha is string => typeof sha === "string")));
    }
  }
  return known;
}

/**
 * The kind of every registered action (pipeline/actions.json, the registry snapshot): `<pkg>/<step>`
 * -> `plumb`, `decide:judgment` or `decide:creative`; undefined for a step the registry does not have.
 */
export function installedActionKinds(): (pkg: string, step: string) => string | undefined {
  const kinds = new Map<string, string>();
  for (const action of loadActions()) kinds.set(`${action.package}/${action.contract.id}`, String(action.contract.kind));
  return (pkg, step) => kinds.get(`${pkg}/${step}`);
}

/** The sha256s an action skill (or a plumb action's action.json) is known by: the installed file's, plus its skill-hashes.json history. */
export function installedSkillShas(history: ReadonlyMap<string, ReadonlySet<string>> = readSkillHashes()): (path: string) => ReadonlySet<string> {
  return path => {
    const shas = new Set(history.get(path) ?? []);
    try { shas.add(sha256Hex(readFileSync(skillFile(path)))); } catch { /* not installed: only its history counts */ }
    return shas;
  };
}

/** The slot ids an ia.json places, read leniently: any string under nodes[].children[].slots[]. */
export function placedIds(ia: unknown): string[] {
  const ids: string[] = [];
  const nodes = (ia as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return ids;
  for (const node of nodes) {
    const children = (node as { children?: unknown } | null)?.children;
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      const slots = (child as { slots?: unknown } | null)?.slots;
      if (Array.isArray(slots)) for (const id of slots) if (typeof id === "string") ids.push(id);
    }
  }
  return ids;
}

/** name → versions over every `packages` entry of a v2/v3 package-lock (nested installs included). */
export function lockfileVersions(lock: unknown): Map<string, Set<string>> {
  const versions = new Map<string, Set<string>>();
  const packages = (lock as { packages?: unknown } | null)?.packages;
  if (!packages || typeof packages !== "object") return versions;
  for (const [key, entry] of Object.entries(packages as Record<string, unknown>)) {
    const at = key.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const name = (entry as { name?: unknown }).name;
    const version = (entry as { version?: unknown }).version;
    if (typeof version !== "string") continue;
    const id = typeof name === "string" ? name : key.slice(at + "node_modules/".length);
    let set = versions.get(id);
    if (!set) versions.set(id, set = new Set());
    set.add(version);
  }
  return versions;
}

function readLockVersions(root: string): Map<string, Set<string>> | undefined {
  try { return lockfileVersions(JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"))); }
  catch { return undefined; }
}

/** The migration manifest, its event files made workspace-relative; undefined when there is none. */
function readMigrations(abs: string, rel: (abs: string) => string, fileOf: (file: string) => string): MigrationsRecord | undefined {
  if (!existsSync(abs)) return undefined;
  const path = rel(abs);
  let value: unknown;
  try { value = JSON.parse(readFileSync(abs, "utf8")); }
  catch (error) { return { path, events: [], error: `not JSON: ${errorText(error)}` }; }
  const issues = validateMigrations(value);
  if (issues.length) return { path, events: [], error: issues.slice(0, 3).join("; ") };
  return { path, events: (value as MigrationsDoc).events.map(event => ({ ...event, file: fileOf(event.file) })) };
}

export interface ContextOptions {
  /** Git history reader; tests substitute one. Defaults to `git log` over the agent trees. */
  readonly history?: (root: string, consumer: string) => CandidateHistory;
  /** Foundry leaf reader; tests substitute one. Defaults to the installed Foundry IA (directorIa, designerIa, writerIa). */
  readonly foundryLeaves?: (agent: FoundryAgent) => ReadonlySet<string>;
  /** Action skill sha256s (R14.2); tests substitute one. Defaults to the installed files plus skill-hashes.json. */
  readonly skillShas?: (path: string) => ReadonlySet<string>;
  /** Action kinds (R14.2); tests substitute one. Defaults to the installed registry (pipeline/actions.json). */
  readonly actionKind?: (pkg: string, step: string) => string | undefined;
  /** The slots a guard or a `--slot` preflight judges (ConstitutionContext.focus); absent, the whole tree. */
  readonly focus?: readonly FocusTarget[];
}

const FOUNDRY_IA: Record<FoundryAgent, () => FoundryIa> = { director: directorIa, designer: designerIa, writer: writerIa };
/** The Foundry-placed leaf ids of an agent, from the installed Foundry IA. */
/** The installed package's leaves, plus the agent's own loop slots (Producer-standard leaves every content agent holds, U9a). */
export const installedFoundryLeaves = (agent: FoundryAgent): ReadonlySet<string> => new Set([...FOUNDRY_IA[agent]().slots.keys(), ...AGENT_LOOPS]);

/** Reads the records under `<consumer>/agents` for the run. `root` is the workspace root rows are relative to. */
export function buildContext(root: string, consumer: string, options: ContextOptions = {}): ConstitutionContext {
  return assembleContext(root, consumer, options);
}

/** A slot to read again: a folder a write changed (or the target of a guard run). */
export interface ChangedSlot { readonly agent: string; readonly slot: string }

/**
 * The context of the tree as it is now, built on `base` (a context of the same consumer read earlier in the same
 * run, under the caller's slot lock): every agent's own files (its listing, ia.json, ledger.json and retired/), the
 * lockfile and the migration manifest are read again, as is every slot folder in `changed` and every folder `base`
 * does not hold; the record of any other slot folder is `base`'s (its `live` re-derived from the ia.json read now).
 * It equals buildContext(root, consumer, options) whenever no folder outside `changed` was written since `base`
 * was read, which is what a guard session's caller states (constitution/guard.ts GuardSession).
 */
export function refreshContext(base: ConstitutionContext, changed: readonly ChangedSlot[], options: ContextOptions = {}): ConstitutionContext {
  const keep = new Map<string, ReadonlyMap<string, SlotRecord>>();
  for (const agent of base.agents) keep.set(agent.agent, agent.slots);
  const dropped = new Set(changed.map(each => `${each.agent}/${each.slot}`));
  return assembleContext(base.root, base.consumer, options, (agent, name) => (dropped.has(`${agent}/${name}`) ? undefined : keep.get(agent)?.get(name)));
}

/** buildContext, with `reuse` naming the slot records of an earlier read that still hold (refreshContext). */
function assembleContext(root: string, consumer: string, options: ContextOptions, reuse?: (agent: string, name: string) => SlotRecord | undefined): ConstitutionContext {
  const rel = (abs: string) => posix(relative(root, abs));
  const readRetired = (dir: string): RetiredRecord[] => listModelDir(dir).sort().flatMap(name => {
    const abs = join(dir, name);
    if (isModelDir(abs)) return [];
    const read = readText(abs);
    const base = { name, path: rel(abs), text: read.text, sha256: read.bytes ? sha256Hex(read.bytes) : "" };
    if (read.error !== undefined) return [{ ...base, error: read.error }];
    if (!name.endsWith(".json")) return [base];
    try { return [{ ...base, value: JSON.parse(read.text) as unknown }]; }
    catch (error) { return [{ ...base, error: `not JSON: ${errorText(error)}` }]; }
  });

  const agents = withSlotReadScope(() => MODEL_AGENTS.map((agent: ModelAgent): AgentRecord => {
    const dir = agentDir(consumer, agent);
    const entries = listModelDir(dir).sort();
    const ia = entries.includes("ia.json") ? readJsonRecord(join(dir, "ia.json"), rel(join(dir, "ia.json"))) : undefined;
    const ledger = entries.includes("ledger.json") ? readJsonRecord(join(dir, "ledger.json"), rel(join(dir, "ledger.json"))) : undefined;
    const liveIds = ia?.value === undefined ? [] : placedIds(ia.value);
    const live = new Set(liveIds);
    const slots = new Map<string, SlotRecord>();
    for (const name of entries) {
      const slotAbs = join(dir, name);
      // retired/ and the non-slot `_` folders (`_retired/<slot>`, `_evidence`) are not slots (records/slots.ts).
      if (!isSlotFolderName(name) || !isModelDir(slotAbs)) continue;
      const kept = reuse?.(agent, name);
      if (kept) { slots.set(name, kept.live === live.has(name) ? kept : { ...kept, live: live.has(name) }); continue; }
      const slotEntries = listModelDir(slotAbs).sort();
      const record = (file: string) => (slotEntries.includes(file) ? readJsonRecord(join(slotAbs, file), rel(join(slotAbs, file))) : undefined);
      const candDir = candidatesDir(slotAbs);
      const slotJson = record("slot.json");
      // One reader for every rule (records/slot-current.ts readCandidateText): the view as text and json, the bytes as raw.
      const candidates: CandidateRecord[] = listModelDir(candDir).sort().flatMap(candidate => {
        const abs = join(candDir, candidate);
        if (isModelDir(abs)) return [];
        const read = readText(abs);
        const path = rel(abs);
        if (read.error !== undefined) return [{ name: candidate, path, text: read.text, raw: read.text, sha256: read.bytes ? sha256Hex(read.bytes) : "", contentDigest: "", headerIssues: [], readError: read.error }];
        const doc = readCandidateText(slotJson?.value, agent, name, candidate, read.text, path);
        const base = {
          name: candidate, path, text: doc.view, raw: doc.raw, sha256: read.bytes ? sha256Hex(read.bytes) : "",
          contentDigest: read.bytes ? doc.contentDigest : "", headerIssues: doc.headerIssues, ...(doc.header ? { header: doc.header } : {}),
        };
        if (!candidate.endsWith(".json")) return [base];
        try { return [{ ...base, json: JSON.parse(doc.view) as unknown }]; }
        catch (error) { return [{ ...base, jsonError: errorText(error) }]; }
      });
      slots.set(name, {
        agent, id: name, dir: rel(slotAbs), live: live.has(name), entries: slotEntries,
        slot: slotJson, pin: record("pin.json"), ledger: record("ledger.json"),
        candidates, retired: slotEntries.includes("retired") ? readRetired(join(slotAbs, "retired")) : [],
      });
    }
    return {
      agent, dir: rel(dir), ia, ...(ledger ? { ledger } : {}), liveIds, slots, entries,
      retired: entries.includes("retired") ? readRetired(join(dir, "retired")) : [],
    };
  }));

  let history: CandidateHistory | undefined;
  const read = options.history ?? readCandidateHistory;
  const lockVersions = readLockVersions(root);
  const migrations = readMigrations(join(consumer, MIGRATIONS_FILE), rel, abs => rel(join(consumer, abs)));
  const leaves = new Map<FoundryAgent, ReadonlySet<string>>();
  const readLeaves = options.foundryLeaves ?? installedFoundryLeaves;
  const foundryLeaves = (agent: FoundryAgent) => { let set = leaves.get(agent); if (!set) leaves.set(agent, set = readLeaves(agent)); return set; };
  const skills = new Map<string, ReadonlySet<string>>();
  let readSkill = options.skillShas;
  const skillShas = (path: string) => {
    let set = skills.get(path);
    if (!set) skills.set(path, set = (readSkill ??= installedSkillShas())(path));
    return set;
  };
  let kindOf = options.actionKind;
  const actionKind = (pkg: string, step: string) => (kindOf ??= installedActionKinds())(pkg, step);
  return { root, consumer, agents, ...(lockVersions ? { lockVersions } : {}), ...(migrations ? { migrations } : {}), history: () => (history ??= read(root, consumer)), foundryLeaves, skillShas, actionKind, ...(options.focus ? { focus: options.focus } : {}) };
}
