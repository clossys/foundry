/**
 * Builds the one `ConstitutionContext` a run judges: every agent tree read once, tolerantly, through
 * the slot-model reader (records/slots.ts). Nothing is validated here. A malformed ia.json, an
 * unparseable pin or an alien folder is kept as it is found, so the rules can report it; a reader
 * that refused bad records would hide exactly what the constitution exists to find.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { sha256Hex } from "../records/hash.js";
import { agentDir, candidatesDir, MODEL_AGENTS, type ModelAgent } from "../records/slot-model/index.js";
import { isModelDir, listModelDir, readModelBytes, withSlotReadScope } from "../records/slots.js";
import { readCandidateHistory } from "./git.js";
import type { AgentRecord, CandidateHistory, CandidateRecord, ConstitutionContext, JsonRecord, RetiredRecord, SlotRecord } from "./types.js";

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
  try { return { path: rel, text: read.text, value: JSON.parse(read.text) as unknown }; }
  catch (error) { return { path: rel, text: read.text, error: `not JSON: ${errorText(error)}` }; }
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

export interface ContextOptions {
  /** Git history reader; tests substitute one. Defaults to `git log` over the agent trees. */
  readonly history?: (root: string, consumer: string) => CandidateHistory;
}

/** Reads the records under `<consumer>/agents` for the run. `root` is the workspace root rows are relative to. */
export function buildContext(root: string, consumer: string, options: ContextOptions = {}): ConstitutionContext {
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
    const liveIds = ia?.value === undefined ? [] : placedIds(ia.value);
    const live = new Set(liveIds);
    const slots = new Map<string, SlotRecord>();
    for (const name of entries) {
      const slotAbs = join(dir, name);
      if (name === "retired" || !isModelDir(slotAbs)) continue;
      const slotEntries = listModelDir(slotAbs).sort();
      const record = (file: string) => (slotEntries.includes(file) ? readJsonRecord(join(slotAbs, file), rel(join(slotAbs, file))) : undefined);
      const candDir = candidatesDir(slotAbs);
      const candidates: CandidateRecord[] = listModelDir(candDir).sort().flatMap(candidate => {
        const abs = join(candDir, candidate);
        if (isModelDir(abs)) return [];
        const read = readText(abs);
        const base = { name: candidate, path: rel(abs), text: read.text, sha256: read.bytes ? sha256Hex(read.bytes) : "" };
        if (read.error !== undefined) return [{ ...base, readError: read.error }];
        if (!candidate.endsWith(".json")) return [base];
        try { return [{ ...base, json: JSON.parse(read.text) as unknown }]; }
        catch (error) { return [{ ...base, jsonError: errorText(error) }]; }
      });
      slots.set(name, {
        agent, id: name, dir: rel(slotAbs), live: live.has(name), entries: slotEntries,
        slot: record("slot.json"), pin: record("pin.json"), ledger: record("ledger.json"),
        candidates, retired: slotEntries.includes("retired") ? readRetired(join(slotAbs, "retired")) : [],
      });
    }
    return {
      agent, dir: rel(dir), ia, liveIds, slots, entries,
      retired: entries.includes("retired") ? readRetired(join(dir, "retired")) : [],
    };
  }));

  let history: CandidateHistory | undefined;
  const read = options.history ?? readCandidateHistory;
  const lockVersions = readLockVersions(root);
  return { root, consumer, agents, ...(lockVersions ? { lockVersions } : {}), history: () => (history ??= read(root, consumer)) };
}
