import { validateComponentRuleTemplate } from "./component-rule-validation.js";
import { CatalogError } from "./api.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import { assertComponentDescriptor, assertComponentFiles, assertComponentPath, componentDescriptorHash, componentInputsHash, componentLibraryHash, componentOf, sortedComponentIds, verifyComponentOutput } from "./resolve-components.js";
import type { ComponentCandidate, ComponentCatalog, ComponentDocument, ComponentFile, ComponentLibrary, ComponentOrigin } from "./resolve-components.js";

export interface SourceBundle {
  slot: string; descriptorHash: string;
  upstream: readonly ComponentFile[]; files: readonly ComponentFile[];
  transform: string; blockers: readonly { code: string; message: string }[];
}
export interface ComponentTransform {
  id: string;
  /** Explicit node-side adapter port; the engine performs no ambient fetch or filesystem IO. */
  run: (fill: ComponentCandidate, upstream: readonly ComponentFile[]) => { files: readonly ComponentFile[]; blockers: readonly { code: string; message: string }[] };
}
export type ComponentFetchPort = (pin: { url: string; commit: string; path: string; sha256: string }) => Promise<string>;
export type ComponentOperation =
  | { op: "adopt"; slot: string; source: string; members?: readonly string[] }
  | { op: "author"; slot: string; fill: ComponentCandidate; files: readonly ComponentFile[] }
  | { op: "derive"; slot: string; rule: string; inputs: readonly string[] }
  | { op: "compose"; slot: string; rule: string }
  | { op: "remove"; slot: string };
export interface ComponentChangeSet { baseHash: string; changes: readonly ComponentOperation[] }

function verifyUpstream(fill: ComponentCandidate, files: readonly ComponentFile[]): void {
  if (!fill.pin?.url || !/^https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(fill.pin.url) || !/^[a-f0-9]{40}$/.test(fill.pin.commit ?? "") || !fill.pin.files?.length) throw new CatalogError("components: exact source pin required");
  const seen = new Set<string>();
  for (const pin of fill.pin.files) {
    assertComponentPath(pin.path, true);
    if (seen.has(pin.path)) throw new CatalogError("components: duplicate upstream pin");
    seen.add(pin.path);
    const matches = files.filter(file => file.path === pin.path);
    if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(pin.sha256) || sha256(matches[0]!.content) !== pin.sha256) throw new CatalogError("components: upstream hash differs");
  }
  if (files.length !== seen.size) throw new CatalogError("components: unpinned upstream bytes");
}
function verifyBundle(fill: ComponentCandidate, bundle: SourceBundle): void {
  assertComponentDescriptor(fill);
  if (bundle.slot !== fill.slot || bundle.descriptorHash !== componentDescriptorHash(fill) || bundle.transform !== fill.transform || bundle.blockers.length) throw new CatalogError("components: missing, stale or blocked source bundle");
  verifyUpstream(fill, bundle.upstream);
  assertComponentFiles(bundle.files);
  verifyComponentOutput(fill, bundle.files);
  if (bundle.files.length !== fill.outputSha256!.length) throw new CatalogError("components: unreceipted output bytes");
}
export async function materializeSourceFill(fill: ComponentCandidate, fetch: ComponentFetchPort, transforms: readonly ComponentTransform[]): Promise<SourceBundle> {
  assertComponentDescriptor(fill);
  if (fill.impl.kind !== "source" || !fill.transform) throw new CatalogError("components: source transform required");
  const matching = transforms.filter(transform => transform.id === fill.transform);
  if (matching.length !== 1) throw new CatalogError("components: unknown or ambiguous registered transform");
  // Validate pin structure before invoking any external capability.
  const placeholders = (fill.pin?.files ?? []).map(pin => ({ path: pin.path, content: "" }));
  if (!fill.pin?.url || !/^https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(fill.pin.url) || !/^[a-f0-9]{40}$/.test(fill.pin.commit ?? "") || !placeholders.length) throw new CatalogError("components: exact source pin required");
  const seen = new Set<string>();
  for (const pin of fill.pin.files!) {
    assertComponentPath(pin.path, true);
    if (seen.has(pin.path) || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw new CatalogError("components: invalid upstream pin");
    seen.add(pin.path);
  }
  const upstream: ComponentFile[] = [];
  for (const pin of [...fill.pin.files!].sort((a, b) => a.path.localeCompare(b.path))) upstream.push({ path: pin.path, content: await fetch({ url: fill.pin.url, commit: fill.pin.commit!, ...pin }) });
  verifyUpstream(fill, upstream);
  const result = matching[0]!.run(structuredClone(fill), structuredClone(upstream));
  const bundle: SourceBundle = { slot: fill.slot, descriptorHash: componentDescriptorHash(fill), upstream, files: result.files, transform: fill.transform, blockers: result.blockers };
  verifyBundle(fill, bundle);
  return structuredClone(bundle);
}
export function generateComponentSelection(library: ComponentLibrary): NonNullable<ComponentLibrary["selection"]> {
  return { version: 2, consumer: library.source.id, slots: [...library.fills].map(doc => {
    const fill = componentOf(doc) as ComponentCandidate & { origin: ComponentOrigin };
    return { slot: fill.slot, originKinds: [fill.origin.kind], sources: [fill.origin.kind === "adopted" ? fill.origin.source : library.source.id] };
  }).sort((a, b) => a.slot.localeCompare(b.slot)) };
}
/** Atomic, pure component-only extension; no check conformance claims are generated. */
export function applyComponentLibraryChange(catalog: ComponentCatalog, library: ComponentLibrary, cs: ComponentChangeSet, bundles: readonly SourceBundle[] = []): ComponentLibrary {
  if (cs.baseHash !== componentLibraryHash(library)) throw new CatalogError("components: changeset baseHash differs");
  assertComponentFiles(library.files);
  const fills = new Map<string, ComponentDocument>();
  for (const doc of library.fills) {
    const fill = componentOf(doc);
    if (fills.has(fill.slot)) throw new CatalogError("components: duplicate consumer fill");
    fills.set(fill.slot, structuredClone(doc));
  }
  let files = structuredClone([...library.files]);
  const snapshot = (): ComponentLibrary => ({ ...library, fills: [...fills.values()].sort((a, b) => a.$extensions["com.clossys.fill"].slot.localeCompare(b.$extensions["com.clossys.fill"].slot)), files: files.sort((a, b) => a.path.localeCompare(b.path)) });
  const install = (slot: string, raw: ComponentCandidate, origin: ComponentOrigin, additions: readonly ComponentFile[]): void => {
    if (raw.slot !== slot) throw new CatalogError("components: operation and descriptor slots differ");
    const fill = structuredClone(raw);
    assertComponentDescriptor(fill);
    fill.source = library.source.id;
    if (origin.kind === "adopted") origin = { ...origin, sha256: componentDescriptorHash(fill) };
    const prior = fills.get(slot);
    const previousFiles = new Set(prior ? componentOf(prior).outputSha256?.map(receipt => receipt.path) ?? [] : []);
    const otherFiles = new Set([...fills].filter(([key]) => key !== slot).flatMap(([, doc]) => componentOf(doc).outputSha256?.map(receipt => receipt.path) ?? []));
    files = files.filter(file => !previousFiles.has(file.path) || otherFiles.has(file.path));
    for (const file of additions) {
      const existing = files.find(existing => existing.path === file.path);
      if (existing && existing.content !== file.content) throw new CatalogError(`components: conflicting output ${file.path}`);
      if (!existing) files.push(structuredClone(file));
    }
    assertComponentFiles(files);
    if (fill.impl.kind === "source") verifyComponentOutput(fill, files);
    if (fill.impl.kind === "package" && additions.length) throw new CatalogError("components: package pointers cannot copy component bytes");
    if (fill.impl.kind === "source" && additions.some(file => !fill.outputSha256?.some(receipt => receipt.path === file.path))) throw new CatalogError("components: unreceipted output bytes");
    fills.set(slot, { $extensions: { "com.clossys.fill": {
      id: `${library.source.id}/${slot}`, slot, source: library.source.id, mode: "implementation", sourceAddress: `fills/${slot}.json`, relation: "same-contract", builtOn: [...fill.composes], conforms: [], evidence: [], author: library.source.author, trust: "consumer", license: fill.license, status: "draft", originKinds: [origin.kind],
    } }, components: { [slot.slice(11)]: { ...fill, origin } } });
  };
  for (const operation of cs.changes) {
    if ("members" in operation) throw new CatalogError("components: operations are slot-scope only");
    if (!catalog.slots.some(slot => slot.id === operation.slot)) throw new CatalogError("components: unknown component slot");
    if (operation.op === "remove") {
      const removed = fills.get(operation.slot); fills.delete(operation.slot);
      const retained = new Set([...fills.values()].flatMap(doc => componentOf(doc).outputSha256?.map(receipt => receipt.path) ?? []));
      const paths = new Set(removed ? componentOf(removed).outputSha256?.map(receipt => receipt.path) ?? [] : []);
      files = files.filter(file => !paths.has(file.path) || retained.has(file.path));
    } else if (operation.op === "adopt") {
      const candidates = catalog.fills.filter(doc => { const meta = doc.$extensions["com.clossys.fill"]; return meta.slot === operation.slot && meta.source === operation.source && meta.mode === "implementation"; });
      if (candidates.length !== 1) throw new CatalogError("components: missing or ambiguous candidate");
      const doc = candidates[0]!, fill = componentOf(doc);
      if (doc.$extensions["com.clossys.fill"].originKinds?.includes("composed")) throw new CatalogError("components: compose-only candidate requires its registered rule");
      assertComponentDescriptor(fill);
      if (!library.adoptedAt || !/^\d{4}-\d{2}-\d{2}$/.test(library.adoptedAt)) throw new CatalogError("components: adoption date required");
      let additions: readonly ComponentFile[] = [];
      if (fill.impl.kind === "source") {
        const matching = bundles.filter(bundle => bundle.slot === fill.slot && bundle.descriptorHash === componentDescriptorHash(fill));
        if (matching.length !== 1) throw new CatalogError("components: source bundle required");
        verifyBundle(fill, matching[0]!); additions = matching[0]!.files;
      }
      install(operation.slot, fill, { kind: "adopted", source: operation.source, fill: doc.$extensions["com.clossys.fill"].id, pin: structuredClone(fill.pin), license: fill.license, sha256: "", adoptedAt: library.adoptedAt, ...(fill.transform ? { transform: fill.transform } : {}), ...(fill.outputSha256 ? { outputSha256: fill.outputSha256 } : {}), ...(fill.notice ? { notice: fill.notice } : {}) }, additions);
    } else if (operation.op === "author") {
      assertComponentFiles(operation.files);
      install(operation.slot, operation.fill, { kind: "authored", license: operation.fill.license }, operation.files);
    } else {
      const matches = catalog.rules?.filter(rule => rule.id === operation.rule && rule.slot === operation.slot && rule.kind === operation.op) ?? [];
      if (matches.length !== 1) throw new CatalogError("components: unknown registered rule");
      const rule = matches[0]!; validateComponentRuleTemplate(rule);
      const inputs = sortedComponentIds(rule.inputs);
      if (inputs.includes(operation.slot)) throw new CatalogError("components: self-referential rule input");
      if (operation.op === "derive" && stableStringify(sortedComponentIds(operation.inputs)) !== stableStringify(inputs)) throw new CatalogError("components: rule inputs differ");
      const inputsHash = componentInputsHash(snapshot(), inputs);
      install(operation.slot, rule.template, operation.op === "derive" ? { kind: "derived", rule: rule.id, inputs, inputsHash } : { kind: "composed", rule: rule.id, reads: inputs, inputsHash }, rule.files);
    }
  }
  // Every resulting dependency must remain consumer-owned; removal rechecks reverse dependents.
  for (const doc of fills.values()) {
    const fill = componentOf(doc) as ComponentCandidate & { origin: ComponentOrigin };
    const inputs = fill.origin.kind === "derived" ? fill.origin.inputs : fill.origin.kind === "composed" ? fill.origin.reads : [];
    for (const dependency of [...fill.reads.components, ...fill.composes, ...inputs]) if (!fills.has(dependency)) throw new CatalogError(`components: dependent ${fill.slot} requires ${dependency}`);
  }
  const result = snapshot(); return { ...result, selection: generateComponentSelection(result) };
}
