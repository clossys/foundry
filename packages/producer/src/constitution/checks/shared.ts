/** Helpers shared by the rule modules: row building, slot lookups, citation and file scans. Pure. */
import { installedPath } from "@clossys/publisher/specimen";
import { parseFrontmatter } from "../../records/slot-model/index.js";
import type { AgentRecord, CandidateRecord, Check, ConstitutionContext, Row, RuleId, SlotRecord } from "../types.js";

export function row(rule: RuleId, check: string, slot: Pick<SlotRecord, "agent" | "id">, reason: string, path: string, candidate?: string): Row {
  return candidate === undefined ? { rule, check, agent: slot.agent, slot: slot.id, reason, path } : { rule, check, agent: slot.agent, slot: slot.id, candidate, reason, path };
}

/**
 * A check nobody has implemented yet. It is never a pass: it reports one `pending` row naming the
 * unit that owns it, so the suite exits non-zero until the owner lands the real check.
 */
export function pending(rule: RuleId, check: string, owner: string, what: string): Check {
  return () => [{ rule, check, agent: "*", slot: "*", reason: `pending: owned by unit ${owner} (${what})`, path: "packages/producer/src/constitution/rules.json", pending: true }];
}

export const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** Live slots of an agent, in IA order, with their folder record when one exists. */
export function liveSlots(agent: AgentRecord): { id: string; record?: SlotRecord }[] {
  return [...new Set(agent.liveIds)].map(id => ({ id, record: agent.slots.get(id) }));
}

/** Every slot folder in every agent tree, live or not. */
export function* allSlots(ctx: ConstitutionContext): Generator<SlotRecord> {
  for (const agent of ctx.agents) yield* agent.slots.values();
}

/** Every live slot folder. */
export function* liveSlotRecords(ctx: ConstitutionContext): Generator<SlotRecord> {
  for (const agent of ctx.agents) for (const { record } of liveSlots(agent)) if (record) yield record;
}

/** slot.json `inputs` ∪ `uses` (the dependency set), or undefined without a parseable slot.json. */
export function dependencySet(slot: SlotRecord): Set<string> | undefined {
  const doc = slot.slot?.value;
  if (!isObject(doc)) return undefined;
  return new Set([...stringList(doc.inputs), ...stringList(doc.uses)]);
}

/** A candidate's metadata: the frontmatter fields of a .md candidate, `meta` of a .json one. */
export function candidateMeta(candidate: CandidateRecord): Record<string, unknown> | undefined {
  if (candidate.name.endsWith(".md")) {
    const parsed = parseFrontmatter(candidate.text);
    return parsed.ok ? parsed.value.fields as Record<string, unknown> : undefined;
  }
  return isObject(candidate.json) && isObject(candidate.json.meta) ? candidate.json.meta : undefined;
}

/** `files[]` of a registry-item candidate (path, type, target, content), skipping malformed entries. */
export function registryFiles(candidate: CandidateRecord): { path: string; type?: string; target?: string; content: string }[] {
  const files = isObject(candidate.json) ? candidate.json.files : undefined;
  if (!Array.isArray(files)) return [];
  return files.flatMap(file => {
    if (!isObject(file) || typeof file.path !== "string") return [];
    return [{
      path: file.path,
      ...(typeof file.type === "string" ? { type: file.type } : {}),
      ...(typeof file.target === "string" ? { target: file.target } : {}),
      content: typeof file.content === "string" ? file.content : "",
    }];
  });
}

/** Where a registry file installs in the consumer app (the Publisher specimen mapping), or undefined. */
export function installPathOf(file: { path: string; type?: string; target?: string }): string | undefined {
  return installedPath(file);
}

/** Every slot id that has a folder anywhere, with its agent. */
export function slotHomes(ctx: ConstitutionContext): Map<string, SlotRecord> {
  const homes = new Map<string, SlotRecord>();
  for (const slot of allSlots(ctx)) if (!homes.has(slot.id)) homes.set(slot.id, slot);
  return homes;
}

/**
 * A version citation `[<agent>:]<slot-id>@[v]<n>` (R07.2), in any text. The slot id must be a known
 * slot; the same boundaries as the audit scan (scratchpad/audit/scan.py VERSION_CITE).
 */
const VERSION_CITE = /(?<![A-Za-z0-9.:/-])(?:(director|designer|writer|publisher|producer):)?([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})@v?([1-9][0-9]*)(?![0-9])/g;
export interface VersionCite { readonly agent?: string; readonly slot: string; readonly version: number; readonly text: string }
export function versionCites(text: string, known: ReadonlySet<string> | ReadonlyMap<string, unknown>): VersionCite[] {
  const cites: VersionCite[] = [];
  for (const match of text.matchAll(VERSION_CITE)) {
    if (!known.has(match[2]!)) continue;
    cites.push({ ...(match[1] ? { agent: match[1] } : {}), slot: match[2]!, version: Number(match[3]), text: match[0] });
  }
  return cites;
}

/** The legal citation grammar `[<agent>:]<slot-id>[#<key>]` plus the illegal version suffix, parsed. */
const CITATION = /^(?:(director|designer|writer|publisher|producer):)?([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})(?:@v?[0-9]+)?(?:#\S+)?$/;
/** `<slot-id>/<candidate>` (a candidate citation, R06.4). */
const CANDIDATE_CITATION = /^([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})\/([a-z0-9][a-z0-9.-]*-v[1-9][0-9]*)(?:\.(?:md|json))?$/;

/** One citation: the slot it names (an `@/` import may resolve to several installing slots: any one is enough). */
export interface Citation { readonly slots: readonly string[]; readonly via: string; readonly text: string }

/**
 * The slot citations a candidate makes, other than to its own slot: source.ref entries, composition
 * parts, version cites in the text, Publisher frame/sections/copy, and `@/` imports resolved through
 * the install-path owners. Only ids of slots that exist count; anything else is not a slot citation.
 */
export function candidateCitations(slot: SlotRecord, candidate: CandidateRecord, homes: ReadonlyMap<string, SlotRecord>, installOwners: ReadonlyMap<string, ReadonlySet<string>>): Citation[] {
  const cites: Citation[] = [];
  const add = (target: string, via: string, text: string) => { if (target !== slot.id && homes.has(target)) cites.push({ slots: [target], via, text }); };
  const meta = candidateMeta(candidate);
  const source = meta && isObject(meta.source) ? meta.source : undefined;
  if (source) {
    for (const ref of stringList(source.ref)) {
      const candidateRef = CANDIDATE_CITATION.exec(ref);
      if (candidateRef) { add(candidateRef[1]!, "source.ref", ref); continue; }
      const citation = CITATION.exec(ref);
      if (citation) add(citation[2]!, "source.ref", ref);
    }
    if (Array.isArray(source.parts)) for (const part of source.parts) if (isObject(part) && typeof part.slot === "string") add(part.slot, "source.parts", part.slot);
  }
  for (const cite of versionCites(candidate.text, homes)) add(cite.slot, "version cite", cite.text);
  const doc = candidate.json;
  if (isObject(doc) && (doc.schema === "clossys.page/1")) {
    if (typeof doc.frame === "string") add(doc.frame, "frame", doc.frame);
    for (const section of stringList(doc.sections)) add(section.split("#")[0]!, "sections", section);
    const copyRefs = (copy: unknown) => (isObject(copy) ? Object.values(copy).filter((value): value is string => typeof value === "string") : []);
    for (const ref of copyRefs(doc.copy)) add(ref.split("#")[0]!, "copy", ref);
    if (isObject(doc.bindings)) for (const binding of Object.values(doc.bindings)) if (isObject(binding)) for (const ref of copyRefs(binding.copy)) add(ref.split("#")[0]!, "copy", ref);
  }
  for (const file of registryFiles(candidate)) {
    for (const match of file.content.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']@\/([^"']+)["']/g)) {
      const owners = importOwners(match[1]!, installOwners);
      if (owners.length && !owners.includes(slot.id)) cites.push({ slots: owners, via: "@/ import", text: `@/${match[1]}` });
    }
  }
  return dedupe(cites);
}

const IMPORT_SUFFIXES = ["", ".tsx", ".ts", ".jsx", ".js", ".css", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
/** The slots installing the file an `@/<spec>` import resolves to (any of the usual extensions). */
export function importOwners(spec: string, installOwners: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  for (const suffix of IMPORT_SUFFIXES) {
    const owners = installOwners.get(`${spec}${suffix}`);
    if (owners?.size) return [...owners].sort();
  }
  return [];
}

function dedupe(cites: Citation[]): Citation[] {
  const seen = new Set<string>();
  return cites.filter(cite => { const key = `${cite.slots.join(",")}\0${cite.via}\0${cite.text}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

/** Install path → the slots whose candidates (any of them) install a file there. */
export function installOwners(ctx: ConstitutionContext): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const slot of allSlots(ctx)) for (const candidate of slot.candidates) for (const file of registryFiles(candidate)) {
    const path = installPathOf(file);
    if (!path) continue;
    let set = owners.get(path);
    if (!set) owners.set(path, set = new Set());
    set.add(slot.id);
  }
  return owners;
}

/** A short, stable list for a reason string. */
export function listed(items: readonly string[], max = 4): string {
  const sorted = [...items];
  return sorted.length <= max ? sorted.join(", ") : `${sorted.slice(0, max).join(", ")} and ${sorted.length - max} more`;
}
