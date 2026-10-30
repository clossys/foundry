import { hashComponentInputClosure, validateInstalledComponentRule } from "./component-rule-validation.js";
import { CatalogError } from "./api.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import { checkComponentProfile, componentDescriptorDigest } from "./check-components.js";
import { assertComponentSecondaryExports, componentSecondaryExports } from "./component-secondary-exports.js";
import type { ComponentCheckFill, ComponentCheckInput, ComponentCheckResult } from "./check-components.js";
import type { ComponentSlot, FillMeta, Source } from "./types.js";

export interface ComponentFile { path: string; content: string }
export interface ComponentCandidate extends ComponentCheckFill {
  /** Opt-in same-entry local function values; source implementations only. */
  secondaryExports?: readonly { name: string; export: string }[];
  transform?: string;
  outputSha256?: readonly { path: string; sha256: string }[];
  blockers?: readonly { code: string; message: string }[];
}
export type ComponentOrigin =
  | { kind: "adopted"; source: string; fill: string; pin: ComponentCandidate["pin"]; license: string; sha256: string; adoptedAt: string; transform?: string; outputSha256?: readonly { path: string; sha256: string }[]; notice?: string }
  | { kind: "authored"; license: string }
  | { kind: "derived"; rule: string; inputs: readonly string[]; inputsHash: string }
  | { kind: "composed"; rule: string; reads: readonly string[]; inputsHash: string };
export interface ComponentCandidateDocument {
  $extensions: { "com.clossys.fill": FillMeta };
  components: Readonly<Record<string, ComponentCandidate>>;
}
export interface ComponentDocument extends ComponentCandidateDocument {
  components: Readonly<Record<string, ComponentCandidate & { origin: ComponentOrigin }>>;
}
/** Standalone component extension; never cast these documents into value-engine FillDoc. */
export interface ComponentLibrary {
  source: Source; fills: readonly ComponentDocument[]; files: readonly ComponentFile[];
  adoptedAt?: string;
  selection?: { version: 2; consumer: string; slots: readonly { slot: string; originKinds: readonly string[]; sources: readonly string[] }[] };
}
export interface ComponentRule {
  id: string; kind: "derive" | "compose"; slot: string; inputs: readonly string[];
  template: ComponentCandidate; files: readonly ComponentFile[];
}
export interface ComponentCatalog { slots: readonly ComponentSlot[]; fills: readonly ComponentCandidateDocument[]; rules?: readonly ComponentRule[] }
export interface ResolvedComponent {
  slot: string; originKind: ComponentOrigin["kind"]; origin: ComponentOrigin;
  impl: Exclude<ComponentCandidate["impl"], { kind: "composed" }>;
  propMap: Readonly<Record<string, string>>;
  reads: { tokens: Readonly<Record<string, string>>; assets: readonly string[]; components: readonly string[] };
  descriptor: ComponentCandidate;
}
export interface ResolvedComponents {
  consumer: string; selectionHash: string;
  components: Readonly<Record<string, ResolvedComponent>>;
  files: readonly ComponentFile[];
  check: ComponentCheckResult;
  /** Independently inspected named-export inventories, never descriptor claims. */
  packageExports: Readonly<Record<string, readonly string[]>>;
}
export interface ComponentResolutionInput {
  catalog: ComponentCatalog; library: ComponentLibrary;
  values: Pick<ComponentCheckInput, "tokens" | "assets">;
  requiredMembers?: ComponentCheckInput["requiredMembers"];
  evidence?: Pick<ComponentCheckInput, "observations" | "installedRac" | "classBindings" | "coherenceGroups">;
  packageExports?: ResolvedComponents["packageExports"];
}
/** Build reporting only: a zero blocker count would still not prove runtime conformance. */
export function componentMaterializationReport(catalog: ComponentCatalog) {
  const leaves = catalog.fills.map(doc => {
    const fill = componentOf(doc);
    return { slot: fill.slot, blockers: fill.blockers?.length ?? 0, codes: sortedComponentIds(fill.blockers?.map(blocker => blocker.code) ?? []) };
  }).sort((a, b) => a.slot < b.slot ? -1 : 1);
  const blocked = leaves.filter(leaf => leaf.blockers > 0).length;
  return { version: 1, descriptorCount: leaves.length, blockedCount: blocked, runtimeConformance: "unassessed", message: blocked === leaves.length ? `No real positive golden: ${blocked}/${leaves.length} descriptors blocked.` : "Rewrite blockers are not runtime conformance evidence.", leaves };
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const sortedComponentIds = (ids: readonly string[]): string[] => [...new Set(ids)].sort(compare);
export function assertComponentIdentifier(value: string): void {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(value)) throw new CatalogError("components: unsafe identifier");
}
export function assertPackageSpecifier(value: string): void {
  if (!/^(?:@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*|[a-z0-9][a-z0-9-]*)(?:\/[a-zA-Z0-9][a-zA-Z0-9_-]*)*$/.test(value)) throw new CatalogError("components: unsafe module specifier");
}
export function assertComponentPath(value: string, upstream = false): void {
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.@-]+)*\.[A-Za-z0-9]+$/.test(value) || value.split("/").some(part => part === "." || part === "..") || (!upstream && !/^(?:components|adapters|notices)\//.test(value))) throw new CatalogError("components: unsafe file path");
}
export function componentOf(doc: ComponentCandidateDocument): ComponentCandidate {
  const meta = doc.$extensions["com.clossys.fill"];
  const entries = Object.entries(doc.components);
  if (!/^components\.[a-z][a-z0-9-]*$/.test(meta.slot) || entries.length !== 1 || entries[0]![0] !== meta.slot.slice(11) || entries[0]![1].slot !== meta.slot || entries[0]![1].source !== meta.source) throw new CatalogError("components: inconsistent whole-leaf document");
  return entries[0]![1];
}
/** Hash domain excludes only provenance, so local descriptor edits remain detectable. */
export function componentDescriptorHash(fill: ComponentCandidate): string {
  return componentDescriptorDigest(fill);
}
export function componentLibraryHash(library: ComponentLibrary): string {
  return `sha256:${sha256(stableStringify({ ...library, fills: [...library.fills].sort((a, b) => compare(a.$extensions["com.clossys.fill"].slot, b.$extensions["com.clossys.fill"].slot)), files: [...library.files].sort((a, b) => compare(a.path, b.path)) }))}`;
}
export function assertComponentDescriptor(fill: ComponentCandidate): void {
  if (!/^components\.[a-z][a-z0-9-]*$/.test(fill.slot)) throw new CatalogError("components: invalid slot");
  assertComponentSecondaryExports(fill);
  if (fill.blockers?.length) throw new CatalogError(`components: blocked materialization ${fill.slot}`);
  if (fill.impl.kind === "composed") throw new CatalogError(`components: unmaterialized composition ${fill.slot}`);
  assertComponentIdentifier(fill.impl.export);
  if (fill.impl.kind === "package") {
    assertPackageSpecifier(fill.impl.module);
    if (!fill.pin?.package || !/^\d+\.\d+\.\d+$/.test(fill.pin.version ?? "")) throw new CatalogError("components: exact package pin required");
    assertPackageSpecifier(fill.pin.package);
    const pointer = /^\.\/([A-Za-z0-9_/-]+)#([A-Z][A-Za-z0-9]*)$/.exec(fill.pin.export ?? "");
    if (!pointer || `${fill.pin.package}/${pointer[1]}` !== fill.impl.module || pointer[2] !== fill.impl.export) throw new CatalogError("components: package export differs from pin");
  } else {
    assertComponentPath(fill.impl.entry);
    if (!fill.impl.entry.startsWith(`components/${fill.slot.slice(11)}/`) || !/\.tsx?$/.test(fill.impl.entry)) throw new CatalogError("components: source entry differs from leaf");
  }
  for (const dependency of fill.deps) if (!dependency.registryItem) assertPackageSpecifier(dependency.name);
}
export function assertComponentFiles(files: readonly ComponentFile[]): void {
  const seen = new Set<string>();
  for (const file of files) {
    assertComponentPath(file.path);
    if (seen.has(file.path)) throw new CatalogError("components: duplicate file path");
    seen.add(file.path);
  }
}
export function verifyComponentOutput(fill: ComponentCandidate, files: readonly ComponentFile[]): void {
  const receipts = fill.outputSha256;
  if (!receipts?.length) throw new CatalogError("components: missing output hashes");
  const expected = new Set<string>();
  for (const receipt of receipts) {
    assertComponentPath(receipt.path);
    if (receipt.path.startsWith("components/") && !receipt.path.startsWith(`components/${fill.slot.slice(11)}/`) && !receipt.path.startsWith("components/_parts/")) throw new CatalogError("components: source output duplicates another component leaf");
    if (expected.has(receipt.path)) throw new CatalogError("components: duplicate output hash");
    expected.add(receipt.path);
    const file = files.find(file => file.path === receipt.path);
    if (!file || !/^[a-f0-9]{64}$/.test(receipt.sha256) || sha256(file.content) !== receipt.sha256) throw new CatalogError("components: output hash differs");
  }
  if (!fill.notice || !expected.has(fill.notice) || !files.find(file => file.path === fill.notice)?.content.trim()) throw new CatalogError("components: licence notice missing");
  if (fill.impl.kind !== "source" || !expected.has(fill.impl.entry)) throw new CatalogError("components: source entry has no output hash");
}
export function componentInputsHash(library: ComponentLibrary, inputs: readonly string[]): string {
  return hashComponentInputClosure(library, inputs);
}
/** Structural resolution and measured checks remain distinct; no observations are manufactured. */
export function resolveComponents(input: ComponentResolutionInput): ResolvedComponents {
  assertComponentFiles(input.library.files);
  const fills = new Map<string, ComponentCandidate>();
  const components: Record<string, ResolvedComponent> = {};
  for (const doc of [...input.library.fills].sort((a, b) => compare(a.$extensions["com.clossys.fill"].slot, b.$extensions["com.clossys.fill"].slot))) {
    const fill = componentOf(doc) as ComponentCandidate & { origin: ComponentOrigin };
    if (fills.has(fill.slot)) throw new CatalogError("components: duplicate whole-leaf implementation");
    if (doc.$extensions["com.clossys.fill"].source !== input.library.source.id) throw new CatalogError("components: foreign library fill");
    if (!input.catalog.slots.some(slot => slot.id === fill.slot)) throw new CatalogError("components: unknown component contract");
    assertComponentDescriptor(fill);
    if (!fill.origin) throw new CatalogError("components: missing origin");
    if (fill.origin.kind === "adopted" && componentDescriptorHash(fill) !== fill.origin.sha256) throw new CatalogError("components: descriptor hand-edit requires authored origin");
    if (fill.impl.kind === "source") verifyComponentOutput(fill, input.library.files);
    componentSecondaryExports(fill, input.library.files);
    fills.set(fill.slot, fill);
  }
  for (const slot of Object.keys(input.requiredMembers ?? {})) if (!fills.has(slot)) throw new CatalogError(`components: missing component ${slot}`);
  const receiptedPaths = new Set([...fills.values()].flatMap(fill => fill.impl.kind === "source" ? fill.outputSha256?.map(receipt => receipt.path) ?? [] : []));
  for (const file of input.library.files) if (!receiptedPaths.has(file.path)) throw new CatalogError(`components: unreceipted consumer file ${file.path}`);
  for (const [slot, fill] of fills) {
    const tokens: Record<string, string> = {};
    for (const leaf of sortedComponentIds(fill.reads.tokens)) {
      const entries = Object.entries(input.values.tokens).filter(([member]) => member === leaf || member.startsWith(`${leaf}.`)).sort(([a], [b]) => compare(a, b));
      if (!entries.length) throw new CatalogError(`components: unresolved token ${leaf}`);
      for (const [member, token] of entries) {
        if (!/^--[A-Za-z0-9-]+$/.test(token.property)) throw new CatalogError("components: unsafe token property");
        tokens[member] = token.property;
      }
    }
    for (const asset of fill.reads.assets) if (!input.values.assets.includes(asset)) throw new CatalogError(`components: unresolved asset ${asset}`);
    for (const dependency of [...fill.reads.components, ...fill.composes]) if (!fills.has(dependency)) throw new CatalogError(`components: unresolved component ${dependency}`);
    if (fill.impl.kind === "composed") throw new CatalogError("components: unmaterialized composition");
    const origin = (fill as ComponentCandidate & { origin: ComponentOrigin }).origin;
    if (origin.kind === "derived" || origin.kind === "composed") {
      validateInstalledComponentRule(fill as ComponentCandidate & { origin: ComponentOrigin }, { rules: input.catalog.rules ?? [], library: input.library });
    }
    components[slot] = { slot, originKind: origin.kind, origin, impl: fill.impl, propMap: structuredClone(fill.propMap), reads: { tokens, assets: sortedComponentIds(fill.reads.assets), components: sortedComponentIds(fill.reads.components) }, descriptor: fill };
  }
  const checkedFills = [...fills.values()].map(fill => {
    const origin = (fill as ComponentCandidate & { origin: ComponentOrigin }).origin;
    return { ...fill, source: origin.kind === "adopted" ? origin.source : fill.source };
  });
  const check = checkComponentProfile({ compositions: { rules: input.catalog.rules ?? [], library: input.library }, slots: input.catalog.slots, fills: checkedFills, tokens: input.values.tokens, assets: input.values.assets, requiredMembers: input.requiredMembers, observations: input.evidence?.observations ?? {}, installedRac: input.evidence?.installedRac ?? { version: "", instance: "" }, classBindings: input.evidence?.classBindings, coherenceGroups: input.evidence?.coherenceGroups, descriptorHashes: Object.fromEntries([...fills].map(([slot, fill]) => [slot, componentDescriptorHash(fill)])) });
  return { consumer: input.library.source.id, selectionHash: componentLibraryHash(input.library), components, files: structuredClone(input.library.files), check, packageExports: structuredClone(input.packageExports ?? {}) };
}
