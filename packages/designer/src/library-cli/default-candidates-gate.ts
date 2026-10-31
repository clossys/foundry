import { parseFill } from "../catalog-core/cell.js";
import { flatten, malformed, references } from "../catalog-core/model.js";
import { assertComponentDescriptor, componentDescriptorHash, componentOf, verifyComponentOutput } from "../catalog-core/resolve-components.js";
import { isSelectableComponentSource } from "../catalog-core/component-sources.js";
import { surfaceEntryOf } from "../catalog-core/surface-library.js";
import { applyLibraryChange, libraryHash } from "../catalog-core/library.js";
import { check as checkValues } from "../catalog-core/check.js";
import type { SourceBundle } from "../catalog-core/changeset-components.js";
import type { BuildCatalogData, CatalogSlot, CompositeCatalogData, LibraryData } from "../catalog-core/types.js";

export interface DefaultCandidatesInput {
  catalog: CompositeCatalogData;
  buildCatalog: Pick<BuildCatalogData, "slots">;
  /** Explicit native policy, resolved before inspecting candidate availability. No fallback. */
  defaultSources: Readonly<Record<string, string | undefined>>;
  sourceHead: string;
  /** SHA-256 of current original source bytes. Absent/mismatched evidence fails closed. */
  sourceHash: (path: string) => string | undefined;
  componentBundles?: readonly SourceBundle[];
  /** Native importer coverage distinguishes an absent implementation from lost evidence. */
  surfaceCoverage?: readonly { slot: string; status: string }[];
}
export interface DefaultCandidateRead { surface: string; fill: string; read: string; slot: string; source: string }
export interface DefaultCandidateMissing { slot: string; source: string; surfaces: string[]; reads: string[]; reasons: string[] }
export interface DefaultCandidatesReport {
  schemaVersion: 1;
  sourceHead: string;
  status: "complete" | "missing-candidates" | "invalid-input";
  scope: string;
  counts: { registeredSlots: number; registeredSurfaces: number; implementationDescriptors: number; checkedReads: number; checkedSlots: number; missingSlots: number };
  checkedReads: DefaultCandidateRead[];
  missing: DefaultCandidateMissing[];
  invalid: string[];
}
const layers = ["themes", "assets", "components", "sections", "frames"] as const;
const surfaceLayers = new Set<string>(["components", "sections", "frames"]);
const unique = (values: readonly string[]) => [...new Set(values)].sort();
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string" && !!item.trim());
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const validMember = (slot: CatalogSlot, read: string): boolean => {
  if (read === slot.id) return true;
  const suffix = read.slice(slot.id.length + 1), members = "members" in slot.contract ? slot.contract.members : undefined;
  if (!members || !record(members)) return false;
  return members.mode === "closed" ? Array.isArray(members.names) && members.names.includes(suffix)
    : members.mode === "open" && typeof members.pattern === "string" && new RegExp(`^(?:${members.pattern})$`).test(suffix);
};

/**
 * Coverage of actual native descriptor read declarations, composition inputs, value references,
 * and attached source measurements across every registered implementation, from every source.
 * Attached scans are source-only lower bounds; this is not full-program or runtime qualification.
 * Allowed-read contracts are permissions and never used as evidence of actual reads.
 */
export function checkDefaultCandidates(input: DefaultCandidatesInput): { exitCode: 0 | 1 | 2; report: DefaultCandidatesReport } {
  const invalid: string[] = [], checkedReads: DefaultCandidateRead[] = [];
  const slots = new Map<string, CatalogSlot>(), candidates = new Map<string, { id: string; source: string; eligible: boolean; members?: Set<string>; reasons: string[] }[]>();
  const surfaces = new Set<string>();
  let descriptors = 0;
  const fail = (text: string) => { invalid.push(text); };
  if (!record(input) || !record(input.catalog) || !record(input.catalog.values) || !record(input.catalog.components)
    || !Array.isArray(input.catalog.values.slots) || !Array.isArray(input.catalog.components.slots)
    || !Array.isArray(input.catalog.values.fills) || !Array.isArray(input.catalog.components.fills)
    || input.catalog.components.rules !== undefined && !Array.isArray(input.catalog.components.rules)
    || input.catalog.surfaces !== undefined && (!record(input.catalog.surfaces) || !Array.isArray(input.catalog.surfaces.slots) || !Array.isArray(input.catalog.surfaces.fills))
    || input.surfaceCoverage !== undefined && !Array.isArray(input.surfaceCoverage)
    || input.componentBundles !== undefined && !Array.isArray(input.componentBundles)
    || !record(input.buildCatalog) || !Array.isArray(input.buildCatalog.slots) || !record(input.defaultSources) || typeof input.sourceHash !== "function") {
    return { exitCode: 2, report: { schemaVersion: 1, sourceHead: typeof input?.sourceHead === "string" ? input.sourceHead : "", status: "invalid-input", scope: "Native catalog input validation failed; no coverage measured.", counts: { registeredSlots: 0, registeredSurfaces: 0, implementationDescriptors: 0, checkedReads: 0, checkedSlots: 0, missingSlots: 0 }, checkedReads: [], missing: [], invalid: ["native catalog, registry, default source policy, and source evidence reader are required"] } };
  }
  if (!/^[a-f0-9]{40}$/.test(input.sourceHead)) fail("sourceHead must be the actual 40-character Git HEAD");
  for (const slot of input.buildCatalog.slots) {
    if (!slot || typeof slot.id !== "string" || !layers.includes(slot.layer as typeof layers[number]) || !slot.id.startsWith(`${slot.layer}.`) || !record(slot.contract)) { fail("malformed registered slot"); continue; }
    if (slots.has(slot.id)) fail(`duplicate registered slot: ${slot.id}`);
    slots.set(slot.id, slot);
  }
  if (!slots.size) fail("registered slot inventory is empty");
  const nativeSlots = [...input.catalog.values.slots, ...input.catalog.components.slots, ...(input.catalog.surfaces?.slots ?? [])];
  const nativeIds = new Set(nativeSlots.flatMap(slot => {
    if (!slot || typeof slot.id !== "string") { fail("malformed native composite contract"); return []; }
    return [slot.id];
  }));
  for (const slot of slots.values()) if (!nativeIds.has(slot.id)) fail(`${slot.id}: registered contract is absent from the native composite catalog`);
  for (const slot of nativeSlots) if (slot && typeof slot.id === "string" && !slots.has(slot.id)) fail(`${slot.id}: native composite contract is unregistered`);
  const orderedSlots = [...slots.values()].sort((a, b) => b.id.length - a.id.length || a.id.localeCompare(b.id));
  const addRead = (surface: string, fill: string, read: unknown) => {
    if (typeof read !== "string" || !read || !/^(themes|assets|components|sections|frames)\.[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(read)) { fail(`${fill}: malformed read ${JSON.stringify(read)}`); return; }
    const slot = orderedSlots.find(slot => read === slot.id || read.startsWith(`${slot.id}.`));
    if (!slot) { fail(`${fill}: unregistered read ${read}`); return; }
    try { if (!validMember(slot, read)) { fail(`${fill}: invalid member read ${read}`); return; } }
    catch (error) { fail(`${fill}: invalid member schema: ${message(error)}`); return; }
    const source = input.defaultSources[slot.id];
    if (typeof source !== "string" || !source.trim()) fail(`MISSING_POLICY ${slot.id}: default source definition is missing`);
    checkedReads.push({ surface, fill, read, slot: slot.id, source: source ?? "" });
  };
  const readArrays = (surface: string, fill: string, value: unknown, required: boolean) => {
    if (value === undefined && !required) return;
    if (!record(value)) { fail(`${fill}: read evidence is missing or malformed`); return; }
    for (const [layer, reads] of Object.entries(value)) {
      if (!layers.includes(layer as typeof layers[number]) || !strings(reads)) { fail(`${fill}: malformed ${layer} reads`); continue; }
      for (const read of reads) {
        if (!read.startsWith(`${layer}.`)) fail(`${fill}: read ${read} is in the wrong layer ${layer}`);
        addRead(surface, fill, read);
      }
    }
    if (required && (!Array.isArray(value.themes) || !Array.isArray(value.assets))) fail(`${fill}: explicit themes and asset read evidence is required`);
  };
  const links = (surface: string, fill: string, values: unknown, required = false) => {
    if (values === undefined && !required) return;
    if (!strings(values)) { fail(`${fill}: malformed composition evidence`); return; }
    values.forEach(read => addRead(surface, fill, read));
  };
  const addCandidate = (slot: string, candidate: { id: string; source: string; eligible: boolean; members?: Set<string>; reasons: string[] }) => candidates.set(slot, [...(candidates.get(slot) ?? []), candidate]);
  const docs = [...input.catalog.values.fills, ...input.catalog.components.fills, ...(input.catalog.surfaces?.fills ?? [])];
  if (!input.catalog.surfaces) fail("native surface catalog is absent");
  const ids = new Set<string>();
  for (const doc of docs) {
    try {
      const meta = doc?.$extensions?.["com.clossys.fill"];
      if (!meta || typeof meta.id !== "string" || typeof meta.slot !== "string" || typeof meta.source !== "string") { fail("malformed candidate metadata"); continue; }
      if (ids.has(meta.id)) { fail(`duplicate candidate identity: ${meta.id}`); continue; }
      ids.add(meta.id);
      const slot = slots.get(meta.slot);
      if (!slot) { fail(`${meta.id}: candidate slot is unregistered: ${meta.slot}`); continue; }
      if (meta.mode === "reference") continue;
      if (surfaceLayers.has(slot.layer) && meta.mode !== "implementation") continue;
      if (meta.mode !== "implementation" && meta.mode !== "derived") { fail(`${meta.id}: invalid candidate mode`); continue; }
      const reasons: string[] = [];
      let members: Set<string> | undefined;
      if (slot.layer === "themes" || slot.layer === "assets") {
        const parsed = parseFill(doc);
        if (!parsed.fill) { fail(`${meta.id}: ${parsed.findings.map(row => row.message).join("; ")}`); continue; }
        const flat = flatten(parsed.fill);
        members = new Set(Object.keys(flat));
        if (!members.size) reasons.push("candidate contains no value members");
        if (slot.contract.kind === "token" || slot.contract.kind === "asset") {
          const required = slot.contract.members.mode === "closed" ? slot.contract.members.names : slot.contract.members.required ?? [];
          const optional = slot.contract.kind === "asset" ? slot.contract.optional ?? [] : [];
          for (const name of unique([...required.filter(name => !optional.includes(name)), ...Object.keys(slot.contract.kind === "token" ? slot.contract.emit ?? {} : {})])) {
            if (!members.has(`${slot.id}.${name}`)) reasons.push(`required native member is absent: ${slot.id}.${name}`);
          }
        }
        for (const [member, token] of Object.entries(flat)) {
          if (!validMember(slot, member)) fail(`${meta.id}: member is outside registered contract: ${member}`);
          if (malformed(token.$type, token.$value, token.$extensions?.["com.clossys.css"]?.raw)) reasons.push(`malformed value ${member}`);
          references(token).forEach(read => addRead(meta.slot, meta.id, read));
        }
        if (slot.layer === "assets") readArrays(meta.slot, meta.id, meta.reads, true);
      } else {
        descriptors++;
        surfaces.add(meta.slot);
        const entry = slot.layer === "components" ? componentOf(doc as Parameters<typeof componentOf>[0]) : surfaceEntryOf(doc as Parameters<typeof surfaceEntryOf>[0]);
        const value = entry as unknown as Record<string, unknown>;
        readArrays(meta.slot, meta.id, value.reads, true);
        links(meta.slot, meta.id, value.composes);
        if (Array.isArray(value.parts)) for (const part of value.parts) {
          if (typeof part === "string") addRead(meta.slot, meta.id, part);
          else if (record(part) && part.slot !== undefined) addRead(meta.slot, meta.id, part.slot);
        }
        for (const key of ["deps", "dependencies"] as const) if (Array.isArray(value[key])) for (const dependency of value[key]) {
          if (record(dependency) && dependency.slot !== undefined) addRead(meta.slot, meta.id, dependency.slot);
          if (record(dependency) && typeof dependency.id === "string" && /^(themes|assets|components|sections|frames)\./.test(dependency.id)) addRead(meta.slot, meta.id, dependency.id);
        }
        if (value.consumption !== undefined) {
          const measurement = value.consumption;
          if (!record(measurement) || measurement.scanStatus !== "lower-bound" || !Array.isArray(measurement.sourceFiles) || !measurement.sourceFiles.length) fail(`${meta.id}: source read evidence is unavailable`);
          else {
            for (const source of measurement.sourceFiles) {
              if (!record(source) || typeof source.path !== "string" || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) fail(`${meta.id}: malformed source evidence`);
              else if (input.sourceHash(source.path) !== source.sha256) fail(`${meta.id}: missing or stale source evidence: ${source.path}`);
            }
            readArrays(meta.slot, meta.id, measurement.scannedReads, true);
            links(meta.slot, meta.id, measurement.scannedComposes, true);
          }
        }
        if (Array.isArray(value.blockers) && value.blockers.length) reasons.push("candidate is blocked");
        if (slot.layer === "components") {
          if (!isSelectableComponentSource(meta.source)) reasons.push("source is not selectable");
          try { assertComponentDescriptor(entry as Parameters<typeof assertComponentDescriptor>[0]); } catch (error) { reasons.push(message(error)); }
          if (entry.impl.kind === "source") {
            const candidate = entry as Parameters<typeof componentDescriptorHash>[0];
            const bundle = input.componentBundles?.find(bundle => bundle.slot === meta.slot && bundle.descriptorHash === componentDescriptorHash(candidate));
            if (!bundle || bundle.blockers.length) reasons.push("verified executable source bundle is unavailable");
            else try { verifyComponentOutput(candidate, bundle.files); } catch (error) { reasons.push(message(error)); }
          }
          if (!strings(value.members)) reasons.push("candidate member evidence is malformed");
          else {
            members = new Set(value.members.map(name => `${slot.id}.${name}`));
            const contract = slot.contract;
            if (contract.kind === "component") {
              const required = contract.members.mode === "closed" ? contract.members.names : contract.members.required ?? [];
              for (const name of required) if (!value.members.includes(name) || !record(value.propMap) || !Object.hasOwn(value.propMap, name)) reasons.push(`required native component member is not mapped: ${name}`);
              for (const name of value.members) if (!validMember(slot, `${slot.id}.${name}`)) reasons.push(`component member is outside the native contract: ${name}`);
            }
          }
        }
      }
      addCandidate(meta.slot, { id: meta.id, source: meta.source, eligible: !reasons.length, members, reasons });
    } catch (error) { fail(`invalid candidate: ${message(error)}`); }
  }
  for (const rule of input.catalog.components.rules ?? []) {
    if (!rule || typeof rule.slot !== "string" || typeof rule.id !== "string" || !record(rule.template)) { fail("malformed registered composition read evidence"); continue; }
    if (!slots.has(rule.slot)) { fail(`${rule.id}: composition slot is unregistered`); continue; }
    surfaces.add(rule.slot);
    readArrays(rule.slot, rule.id, rule.template.reads, true);
    links(rule.slot, rule.id, rule.inputs, true);
    links(rule.slot, rule.id, rule.template.composes);
  }
  for (const row of input.surfaceCoverage ?? []) if (!row || typeof row.slot !== "string" || !["candidate", "subset", "unavailable"].includes(row.status)) fail("malformed native surface coverage evidence");
  for (const slot of slots.values()) if (surfaceLayers.has(slot.layer) && !surfaces.has(slot.id)) {
    const coverage = input.surfaceCoverage?.filter(row => row && row.slot === slot.id) ?? [];
    if (!coverage.length || coverage.some(row => row.status !== "unavailable")) fail(`${slot.id}: registered surface has no implementation read evidence or explicit unavailable coverage`);
  }
  if (!surfaces.size || !descriptors) fail("registered implementation surface inventory is empty");
  if (!checkedReads.length) fail("read inventory is empty; no coverage was measured");
  const reads = [...new Map(checkedReads.map(row => [JSON.stringify(row), row])).values()].sort((a, b) => a.slot.localeCompare(b.slot) || a.surface.localeCompare(b.surface) || a.fill.localeCompare(b.fill) || a.read.localeCompare(b.read));
  const missing: DefaultCandidateMissing[] = [];
  for (const id of unique(reads.map(row => row.slot))) {
    const rows = reads.filter(row => row.slot === id), source = input.defaultSources[id] ?? "";
    const offered = (candidates.get(id) ?? []).filter(candidate => candidate.source === source);
    if (slots.get(id)?.layer === "themes" || slots.get(id)?.layer === "assets") for (const candidate of offered) {
      try {
        const empty: LibraryData = { source: { id: "default-candidate-check", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: new Date().toISOString().slice(0, 10), fills: [] };
        const library = applyLibraryChange(input.catalog.values, empty, { baseHash: libraryHash(empty), changes: [{ op: "adopt", slot: id, source }] });
        const ownedIds = new Set(library.fills.map(doc => doc.$extensions["com.clossys.fill"].id));
        const findings = checkValues({ catalog: input.catalog.values, library }).findings.filter(finding => finding.severity === "error" && (finding.subject === id || finding.subject.startsWith(`${id}.`) || ownedIds.has(finding.subject)));
        candidate.reasons.push(...findings.map(finding => `${finding.code}: ${finding.message}`));
        if (findings.length) candidate.eligible = false;
      } catch (error) { candidate.eligible = false; candidate.reasons.push(`native adoption/check refused: ${message(error)}`); }
    }
    const eligible = offered.filter(candidate => candidate.eligible && rows.every(row => row.read === id || !candidate.members || candidate.members.has(row.read)));
    if (!eligible.length) missing.push({ slot: id, source, surfaces: unique(rows.map(row => row.surface)), reads: unique(rows.map(row => row.read)), reasons: unique(offered.length ? offered.flatMap(candidate => candidate.reasons.length ? candidate.reasons : ["candidate does not contain every declared read member"]) : ["no implementation candidate in the default source"]) });
  }
  const errors = unique(invalid), exitCode = errors.length ? 2 : missing.length ? 1 : 0;
  return { exitCode, report: { schemaVersion: 1, sourceHead: input.sourceHead, status: exitCode === 2 ? "invalid-input" : exitCode === 1 ? "missing-candidates" : "complete", scope: "All native registered implementation descriptor reads, value references, composition inputs, and attached source-only lower-bound measurements. Registered slots without implementations require explicit native unavailable coverage; no runtime or full-program coverage claim.", counts: { registeredSlots: slots.size, registeredSurfaces: [...slots.values()].filter(slot => surfaceLayers.has(slot.layer)).length, implementationDescriptors: descriptors, checkedReads: reads.length, checkedSlots: unique(reads.map(row => row.slot)).length, missingSlots: missing.length }, checkedReads: reads, missing, invalid: errors } };
}
