/** Record association only. These digests never authenticate a runtime renderer. */
import { check, libraryHash, resolve } from "./api.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import { flatten, references } from "./model.js";
import { originOf, tokenContent } from "./library.js";
import { componentDescriptorHash, componentOf, verifyComponentOutput, assertComponentFiles } from "./resolve-components.js";
import { validateInstalledComponentRule } from "./component-rule-validation.js";
import { isSurfacePackageEntry, surfaceEntryOf, surfaceOf, surfaceDescriptorHash, verifySurfaceFiles, verifySurfacePackageProvenance, verifySurfaceProvenance } from "./surface-library.js";
import { runtimeHash, runtimeSnapshot } from "./runtime-ports.js";
import type { RuntimeDigest } from "./runtime-ports.js";
import type { CatalogBundles, SourceCandidateBytes } from "../catalog-bundles.js";
import type { CompositeEngineInput, CompositeFinding, DtcgToken, FillDoc, FillMeta, Origin } from "./types.js";
import type { ComponentCandidate, ComponentCandidateDocument, ComponentDocument, ComponentFile, ComponentOrigin, ComponentRule } from "./resolve-components.js";
import type { SurfaceCandidate, SurfaceCandidateDocument, SurfaceDocument, SurfaceOrigin, SurfacePackageEntry, SurfacePackageOrigin, SurfaceRule, SurfaceTransform } from "./surface-types.js";

export interface SourceOwnerNeed {
  readonly code: "SOURCE_RECORD_MISSING" | "SOURCE_RECORD_AMBIGUOUS" | "SOURCE_RECORD_STALE" | "SOURCE_BYTES_MISSING" | "SOURCE_RULE_INPUT_MISSING";
  readonly source?: string; readonly fill?: string; readonly slot?: string; readonly member?: string;
  readonly message: string;
}
interface RecordBase {
  readonly id: string; readonly source: string; readonly portion: "values" | "components" | "surfaces";
  readonly fill: string; readonly slot: string; readonly member?: string;
  readonly origin?: Origin | ComponentOrigin | SurfaceOrigin | SurfacePackageOrigin;
  readonly upstream?: { readonly fill: string; readonly slot: string; readonly member?: string };
  readonly files: readonly ComponentFile[];
  readonly evidence?: SourceCandidateBytes;
  readonly findings: readonly CompositeFinding[];
  readonly inputs: readonly string[];
  readonly inputRecords: readonly SourceOwnerRecord[];
  readonly rule?: ComponentRule | NonNullable<CompositeEngineInput["catalog"]["values"]["rules"]>[number] | Omit<SurfaceRule, "run">;
  readonly transform?: Omit<SurfaceTransform, "run">;
  readonly packages?: NonNullable<CompositeEngineInput["surfaceOptions"]>["packages"];
}
export type SourceOwnerRecord = RecordBase & (
  | { readonly kind: "value-member"; readonly document: FillDoc; readonly token: DtcgToken; readonly candidate?: FillDoc }
  | { readonly kind: "component"; readonly document: ComponentDocument; readonly descriptor: ComponentCandidate; readonly candidate?: ComponentCandidateDocument }
  | { readonly kind: "surface"; readonly document: SurfaceDocument; readonly descriptor: SurfaceCandidate | SurfacePackageEntry; readonly candidate?: SurfaceCandidateDocument }
  | { readonly kind: "offer"; readonly document: FillDoc | ComponentCandidateDocument | SurfaceCandidateDocument; readonly token?: DtcgToken; readonly descriptor?: ComponentCandidate | SurfaceCandidate | SurfacePackageEntry; readonly notices: CatalogBundles["notices"] }
);
export type SourceOwnerClosureResult = {
  readonly consumer: string; readonly records: readonly SourceOwnerRecord[]; readonly runtimeQualification: "unavailable";
} & ({ readonly status: "associated"; readonly libraryHash: string; readonly selectionHash: string; readonly bySource: Readonly<Record<string, readonly SourceOwnerRecord[]>>; readonly sourceHashes: Readonly<Record<string, RuntimeDigest>> }
  | { readonly status: "pending"; readonly needs: readonly SourceOwnerNeed[] });

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const identity = (kind: string, portion: string, fill: string, slot: string, member?: string) => JSON.stringify([kind, portion, fill, slot, member ?? null]);
const equal = (a: unknown, b: unknown) => stableStringify(a ?? null) === stableStringify(b ?? null);
const metaOf = (doc: { $extensions: { "com.clossys.fill": FillMeta } }) => doc.$extensions["com.clossys.fill"];
type Unlinked = SourceOwnerRecord extends infer T ? T extends SourceOwnerRecord ? Omit<T, "inputRecords"> : never : never;

/** Internal entry; only the existing catalog-bundles leaf supplies the pinned bytes. */
export function associateSourceOwnerRecords(original: CompositeEngineInput, bundles: CatalogBundles): SourceOwnerClosureResult {
  const needs: SourceOwnerNeed[] = [], raw: SourceOwnerRecord[] = [];
  const consumer = original.library.source.id;
  const need = (code: SourceOwnerNeed["code"], message: string, at: Partial<SourceOwnerNeed> = {}) => { needs.push({ ...at, code, message }); };
  const guarded = (run: () => void, at: Partial<SourceOwnerNeed> = {}) => {
    try { run(); } catch (error) { need("SOURCE_RECORD_STALE", error instanceof Error ? error.message : String(error), at); }
  };
  let input: CompositeEngineInput, findings: readonly CompositeFinding[] = [], selectionHash = "", wholeHash = "";
  try {
    // Callbacks stay on the original engine input. Only finite record data is copied.
    input = { ...original, library: runtimeSnapshot(original.library), catalog: { ...original.catalog, values: runtimeSnapshot(original.catalog.values), components: runtimeSnapshot(original.catalog.components) } };
    wholeHash = libraryHash(input.library);
    findings = check(input).findings;
    selectionHash = resolve(input).selectionHash;
  } catch (error) {
    need("SOURCE_RECORD_STALE", error instanceof Error ? error.message : String(error));
    // Preserve inspectable records even when original resolution refuses.
    input = original;
  }
  const add = (record: Unlinked) => { raw.push({ ...record, inputRecords: [] } as SourceOwnerRecord); };
  const atFindings = (slot: string, member?: string) => findings.filter(row => row.subject === slot || row.subject === member || row.subject === consumer);
  const exactly = <T>(matches: readonly T[], at: Partial<SourceOwnerNeed>): T | undefined => {
    if (matches.length !== 1) { need(matches.length ? "SOURCE_RECORD_AMBIGUOUS" : "SOURCE_RECORD_MISSING", "Exact source fill and slot association required", at); return undefined; }
    return matches[0];
  };
  const componentId = (slot: string) => raw.find(row => row.kind === "component" && row.slot === slot)?.id;
  const surfaceId = (slot: string) => raw.find(row => row.kind === "surface" && row.slot === slot)?.id;
  const pendingInputs = new Map<string, readonly { portion: "values" | "components" | "surfaces"; target: string }[]>();
  const byteEvidence = (doc: ComponentCandidateDocument): SourceCandidateBytes | undefined => {
    const meta = metaOf(doc), descriptor = componentOf(doc), at = { source: meta.source, fill: meta.id, slot: meta.slot };
    if (descriptor.impl.kind !== "source") return undefined;
    const evidence = exactly(bundles.sourceCandidates.filter(row => row.fill === meta.id && row.slot === meta.slot), at);
    if (!evidence) return undefined;
    guarded(() => {
      if (componentDescriptorHash(descriptor) !== evidence.descriptorHash || descriptor.transform !== evidence.transform || !equal(descriptor.blockers ?? [], evidence.blockers)) throw new Error("Source candidate descriptor, transform or blockers differ");
      const pins = descriptor.pin?.files ?? [];
      if (!pins.length || pins.length !== evidence.upstreamFiles.length || new Set(pins.map(pin => pin.path)).size !== pins.length) throw new Error("Missing or duplicate upstream bytes");
      for (const pin of pins) {
        const files = evidence.upstreamFiles.filter(file => file.path === pin.path);
        if (files.length !== 1 || sha256(files[0]!.content) !== pin.sha256) throw new Error("Upstream source bytes differ from original pins");
      }
      assertComponentFiles(evidence.outputFiles); verifyComponentOutput(descriptor, evidence.outputFiles);
      if (evidence.outputFiles.length !== descriptor.outputSha256?.length) throw new Error("Unreceipted candidate output bytes");
      if ((evidence.status === "blocked") !== (evidence.blockers.length > 0)) throw new Error("Candidate status and blockers differ");
    }, at);
    return evidence;
  };
  const ownedSlots = new Set<string>();
  for (const doc of input.library.values.fills) guarded(() => {
    const meta = metaOf(doc);
    if (ownedSlots.has(meta.slot)) need("SOURCE_RECORD_AMBIGUOUS", "Duplicate owned value slot", { fill: meta.id, slot: meta.slot });
    ownedSlots.add(meta.slot);
    if (meta.source !== consumer) need("SOURCE_RECORD_STALE", "Foreign consumer value document", { fill: meta.id, slot: meta.slot });
    const members = Object.entries(flatten(doc)).sort(([a], [b]) => compare(a, b));
    if (!members.length) need("SOURCE_RECORD_MISSING", "Owned value document has no actual members", { fill: meta.id, slot: meta.slot });
    for (const [member, token] of members) {
      const origin = originOf(token), at = { fill: meta.id, slot: meta.slot, member };
      let candidate: FillDoc | undefined, rule: RecordBase["rule"];
      if (!origin) need("SOURCE_RECORD_MISSING", "Member provenance missing", at);
      if (origin?.kind === "adopted") {
        candidate = exactly(input.catalog.values.fills.filter(up => metaOf(up).id === origin.fill && metaOf(up).slot === meta.slot), { ...at, source: origin.source });
        const tokenUp = candidate && flatten(candidate)[origin.member];
        if (!tokenUp || metaOf(candidate!).source !== origin.source || sha256(stableStringify(tokenContent(tokenUp))) !== origin.sha256) need("SOURCE_RECORD_STALE", "Original adopted token association differs", at);
      }
      if (origin?.kind === "derived") rule = exactly(input.catalog.values.rules?.filter(rule => rule.id === origin.rule && rule.slot === meta.slot) ?? [], at);
      if (origin?.kind === "composed") need("SOURCE_RULE_INPUT_MISSING", "Value composition has no executable registered value rule", at);
      const row = { kind: "value-member" as const, id: identity("value-member", "values", meta.id, meta.slot, member), source: origin?.kind === "adopted" ? origin.source : consumer, portion: "values" as const, fill: meta.id, slot: meta.slot, member, document: doc, token, origin, candidate, ...(origin?.kind === "adopted" ? { upstream: { fill: origin.fill, slot: meta.slot, member: origin.member } } : {}), files: [], findings: atFindings(meta.slot, member), rule, inputs: [] };
      add(row);
      pendingInputs.set(row.id, [...new Set([...references(token), ...(origin?.kind === "derived" ? origin.inputs : [])])].map(target => ({ portion: "values", target })));
    }
  });
  for (const doc of input.catalog.values.fills) guarded(() => {
    const meta = metaOf(doc);
    for (const [member, token] of Object.entries(flatten(doc)).sort(([a], [b]) => compare(a, b))) add({ kind: "offer", id: identity("offer", "values", meta.id, meta.slot, member), source: meta.source, portion: "values", fill: meta.id, slot: meta.slot, member, document: doc, token, files: [], findings: [], inputs: [], notices: bundles.notices });
  });
  for (const doc of input.catalog.components.fills) guarded(() => {
    const meta = metaOf(doc), descriptor = componentOf(doc), evidence = byteEvidence(doc);
    add({ kind: "offer", id: identity("offer", "components", meta.id, meta.slot), source: meta.source, portion: "components", fill: meta.id, slot: meta.slot, document: doc, descriptor, evidence, files: evidence?.outputFiles ?? [], findings: [], inputs: [], notices: bundles.notices });
  });
  const ownedComponents = { ...input.library.components, source: input.library.source, adoptedAt: input.library.adoptedAt };
  const receipted = new Set<string>();
  guarded(() => assertComponentFiles(ownedComponents.files));
  for (const doc of ownedComponents.fills) guarded(() => {
    const meta = metaOf(doc), descriptor = componentOf(doc) as ComponentCandidate & { origin: ComponentOrigin }, origin = descriptor.origin, at = { fill: meta.id, slot: meta.slot };
    let candidate: ComponentCandidateDocument | undefined, evidence: SourceCandidateBytes | undefined, rule: ComponentRule | undefined;
    if (meta.source !== consumer || !origin) need("SOURCE_RECORD_STALE", "Foreign consumer component or absent origin", at);
    if (origin?.kind === "adopted") {
      candidate = exactly(input.catalog.components.fills.filter(up => metaOf(up).id === origin.fill && metaOf(up).slot === meta.slot), { ...at, source: origin.source });
      if (candidate) {
        const up = componentOf(candidate); evidence = byteEvidence(candidate);
        if (up.source !== origin.source || componentDescriptorHash(descriptor) !== origin.sha256 || componentDescriptorHash({ ...descriptor, source: up.source }) !== componentDescriptorHash(up) || !equal(origin.pin, up.pin) || origin.license !== up.license || origin.transform !== up.transform || !equal(origin.outputSha256, up.outputSha256) || origin.notice !== up.notice) need("SOURCE_RECORD_STALE", "Installed and upstream descriptor provenance differ in their original domains", at);
      }
    }
    if (origin?.kind === "derived" || origin?.kind === "composed") guarded(() => { rule = validateInstalledComponentRule(descriptor, { library: ownedComponents, rules: input.catalog.components.rules ?? [] }); }, at);
    const files: ComponentFile[] = [];
    if (descriptor.impl.kind === "source") {
      guarded(() => verifyComponentOutput(descriptor, ownedComponents.files), at);
      for (const receipt of descriptor.outputSha256 ?? []) {
        receipted.add(receipt.path); const file = ownedComponents.files.find(file => file.path === receipt.path);
        if (file) files.push(file); else need("SOURCE_BYTES_MISSING", "Owned component output byte missing", at);
      }
    }
    const row = { kind: "component" as const, id: identity("component", "components", meta.id, meta.slot), source: origin?.kind === "adopted" ? origin.source : consumer, portion: "components" as const, fill: meta.id, slot: meta.slot, document: doc, descriptor, origin, candidate, evidence, ...(origin?.kind === "adopted" ? { upstream: { fill: origin.fill, slot: meta.slot } } : {}), files, findings: atFindings(meta.slot), rule, inputs: [] };
    add(row);
    pendingInputs.set(row.id, [
      ...[...new Set([...descriptor.reads.components, ...descriptor.composes, ...(origin?.kind === "derived" ? origin.inputs : origin?.kind === "composed" ? origin.reads : [])])].map(target => ({ portion: "components" as const, target })),
      ...[...descriptor.reads.themes, ...descriptor.reads.assets].map(target => ({ portion: "values" as const, target })),
    ]);
  });
  for (const file of ownedComponents.files) if (!receipted.has(file.path)) need("SOURCE_BYTES_MISSING", `Unassociated component file ${file.path}`);
  const surfacePaths = new Set<string>();
  for (const doc of input.library.surfaces?.fills ?? []) guarded(() => {
    const entry = surfaceEntryOf(doc);
    if (isSurfacePackageEntry(entry)) {
      // Package pointer: owns no bytes; joined to exactly one catalog package candidate and the installed export evidence for its pin.
      const meta = metaOf(doc), origin = entry.origin, at = { fill: meta.id, slot: meta.slot };
      if (!origin) { need("SOURCE_RECORD_STALE", "Package pointer origin missing", at); return; }
      guarded(() => verifySurfacePackageProvenance(input.catalog, entry as SurfacePackageEntry & { origin: SurfacePackageOrigin }), at);
      const candidate = exactly(input.catalog.surfaces?.fills.filter(up => metaOf(up).id === origin.fill && metaOf(up).slot === meta.slot) ?? [], at);
      const pack = exactly(input.surfaceOptions?.packages.filter(row => row.module === entry.impl.module && row.version === origin.pin.version && row.values.includes(entry.impl.export)) ?? [], at);
      const id = identity("surface", "surfaces", meta.id, meta.slot);
      add({ kind: "surface", id, source: origin.source, portion: "surfaces", fill: meta.id, slot: meta.slot, document: doc, descriptor: entry, origin, candidate, upstream: { fill: origin.fill, slot: meta.slot }, packages: pack ? [pack] : [], files: [], findings: atFindings(meta.slot), inputs: [] });
      pendingInputs.set(id, []);
      return;
    }
    const meta = metaOf(doc), descriptor = surfaceOf(doc) as SurfaceCandidate & { origin: SurfaceOrigin }, origin = descriptor.origin, at = { fill: meta.id, slot: meta.slot };
    let candidate: SurfaceCandidateDocument | undefined, rule: RecordBase["rule"], transform: RecordBase["transform"];
    if (origin.kind !== "authored") {
      candidate = exactly(input.catalog.surfaces?.fills.filter(up => metaOf(up).id === origin.base.fill && metaOf(up).slot === meta.slot) ?? [], at);
      if (candidate && (metaOf(candidate).source !== origin.base.source || surfaceDescriptorHash(surfaceOf(candidate)) !== origin.base.descriptorHash)) need("SOURCE_RECORD_STALE", "Surface upstream descriptor differs", at);
      const registered = exactly(input.catalog.surfaces?.transforms.filter(t => equal(t.identity, origin.transform)) ?? [], at);
      if (registered) { const { run: _run, ...data } = registered; transform = data; }
    }
    if (origin.kind === "derived") {
      const registered = exactly(input.catalog.surfaces?.rules.filter(rule => equal(rule.identity, origin.rule) && rule.slot === meta.slot) ?? [], at);
      if (registered) { const { run: _run, ...data } = registered; rule = data; }
    }
    const paths = new Set(descriptor.outputSha256.map(row => row.path));
    const files = input.library.surfaces!.files.filter(file => paths.has(file.path));
    guarded(() => { verifySurfaceFiles(descriptor, input.library.surfaces!.files); verifySurfaceProvenance(input.catalog, input.library, descriptor); }, at);
    paths.forEach(path => surfacePaths.add(path));
    const packages = descriptor.dependencies.flatMap(dependency => {
      const pack = exactly(input.surfaceOptions?.packages.filter(pack => pack.module === dependency.module && pack.version === dependency.version) ?? [], at);
      return pack ? [pack] : [];
    });
    const row = { kind: "surface" as const, id: identity("surface", "surfaces", meta.id, meta.slot), source: origin.kind === "adopted" ? origin.base.source : consumer, portion: "surfaces" as const, fill: meta.id, slot: meta.slot, document: doc, descriptor, origin, candidate, ...(origin.kind !== "authored" ? { upstream: { fill: origin.base.fill, slot: meta.slot } } : {}), rule, transform, packages, files, findings: atFindings(meta.slot), inputs: [] };
    add(row);
    pendingInputs.set(row.id, [
      ...(origin.kind === "derived" ? origin.inputs.filter(item => item.input.kind !== "dependency").map(item => ({ portion: item.input.kind === "value" ? "values" as const : item.input.kind === "component" ? "components" as const : "surfaces" as const, target: item.input.id })) : []),
      ...[...descriptor.reads.themes, ...descriptor.reads.assets].map(target => ({ portion: "values" as const, target })),
      ...descriptor.composes.map(target => ({ portion: target.startsWith("components.") ? "components" as const : "surfaces" as const, target })),
    ]);
  });
  for (const file of input.library.surfaces?.files ?? []) if (!surfacePaths.has(file.path)) need("SOURCE_BYTES_MISSING", `Unassociated surface file ${file.path}`);
  for (const doc of input.catalog.surfaces?.fills ?? []) guarded(() => {
    const meta = metaOf(doc); add({ kind: "offer", id: identity("offer", "surfaces", meta.id, meta.slot), source: meta.source, portion: "surfaces", fill: meta.id, slot: meta.slot, document: doc, descriptor: surfaceEntryOf(doc) as SurfaceCandidate | SurfacePackageEntry, files: [], findings: [], inputs: [], notices: bundles.notices });
  });
  // Existing provenance refusals retain their original messages, including upstream drift notices.
  for (const finding of findings) if (finding.rule === "provenance" || finding.code === "C7" || finding.code === "R" || ["S1", "S2", "S6"].includes(finding.code) && finding.severity === "error") need("SOURCE_RECORD_STALE", finding.message, { slot: finding.subject });
  // Check the complete owned inventory independently of grouping or recursive linking.
  const expected = [
    ...input.library.values.fills.flatMap(doc => Object.keys(flatten(doc)).map(member => identity("value-member", "values", metaOf(doc).id, metaOf(doc).slot, member))),
    ...input.library.components.fills.map(doc => identity("component", "components", metaOf(doc).id, metaOf(doc).slot)),
    ...(input.library.surfaces?.fills ?? []).map(doc => identity("surface", "surfaces", metaOf(doc).id, metaOf(doc).slot)),
  ].sort(compare);
  if (!equal(expected, raw.filter(row => row.kind !== "offer").map(row => row.id).sort(compare))) need("SOURCE_RECORD_MISSING", "Complete owned record inventory differs");
  const byId = new Map<string, SourceOwnerRecord>();
  for (const record of raw) {
    if (byId.has(record.id)) need("SOURCE_RECORD_AMBIGUOUS", "Duplicate actual record identity", { fill: record.fill, slot: record.slot, member: record.member });
    byId.set(record.id, record);
  }
  for (const record of raw) {
    const inputs = (pendingInputs.get(record.id) ?? []).flatMap(ref => {
      const ids = ref.portion === "values" ? raw.filter(row => row.kind === "value-member" && (row.member === ref.target || row.slot === ref.target)).map(row => row.id) : [ref.portion === "components" ? componentId(ref.target) : surfaceId(ref.target)].filter((id): id is string => !!id);
      if (!ids.length) need("SOURCE_RULE_INPUT_MISSING", `Actual input record missing: ${ref.target}`, { fill: record.fill, slot: record.slot });
      return ids;
    });
    (record as { inputs: readonly string[] }).inputs = [...new Set(inputs)].sort(compare);
  }
  const linked = new Map<string, SourceOwnerRecord>(), active = new Set<string>();
  const link = (record: SourceOwnerRecord): SourceOwnerRecord => {
    if (linked.has(record.id)) return linked.get(record.id)!;
    if (active.has(record.id)) { need("SOURCE_RULE_INPUT_MISSING", "Cyclic actual record inputs", { fill: record.fill, slot: record.slot }); return { ...record, inputRecords: [] }; }
    active.add(record.id); const result = { ...record, inputRecords: record.inputs.map(id => link(byId.get(id)!)) };
    active.delete(record.id); linked.set(record.id, result); return result;
  };
  const records = raw.sort((a, b) => compare(a.id, b.id)).map(link);
  const base = { consumer, records, runtimeQualification: "unavailable" as const };
  if (needs.length) return runtimeSnapshot({ ...base, status: "pending" as const, needs });
  const sources = [...new Set(records.map(record => record.source))].sort(compare);
  const bySource = Object.fromEntries(sources.map(source => [source, records.filter(record => record.source === source)]));
  return runtimeSnapshot({ ...base, status: "associated" as const, libraryHash: wholeHash, selectionHash, bySource, sourceHashes: Object.fromEntries(sources.map(source => [source, runtimeHash(bySource[source])])) });
}
