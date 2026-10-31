import { EditRefusal } from "./edit-session.js";
import { applyLibraryChange, generateSelection, libraryHash } from "../catalog-core/index.js";
import type { CatalogData, ChangeSet, DtcgToken, FillDoc, LibraryData } from "../catalog-core/index.js";

const stable = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const slotOf = (doc: FillDoc): string => doc.$extensions["com.clossys.fill"].slot;
const leafFill = (library: LibraryData, leaf: string): FillDoc | undefined => library.fills.find(doc => slotOf(doc) === leaf);
function tokensOf(doc: FillDoc, leaf: string): Record<string, DtcgToken> {
  const tokens: Record<string, DtcgToken> = {};
  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== "object") return;
    if ("$value" in value) { tokens[path] = value as DtcgToken; return; }
    for (const [key, child] of Object.entries(value)) if (!key.startsWith("$")) visit(child, path ? `${path}.${key}` : key);
  };
  visit(doc[leaf.startsWith("themes.") ? "themes" : "assets"], leaf.split(".")[0]!);
  return tokens;
}
/** Existing operations only. Exact equality is the acceptance condition, never inferred provenance. */
export function valueHistoryChanges(catalog: CatalogData, current: LibraryData, target: LibraryData, leaf: string, expected: LibraryData): ChangeSet {
  if (current.source.id !== target.source.id || current.source.id !== expected.source.id) throw new TypeError("Studio history consumer differs");
  if (stable(leafFill(current, leaf)) !== stable(leafFill(expected, leaf))) throw new EditRefusal("conflict", "Studio history leaf changed elsewhere");
  const desired = leafFill(target, leaf);
  const fills = [...current.fills.filter(doc => slotOf(doc) !== leaf), ...(desired ? [desired] : [])];
  const expectedLibrary = { ...current, fills };
  const expectedHash = libraryHash({ ...expectedLibrary, selection: generateSelection(expectedLibrary) });
  const baseHash = libraryHash(current);
  if (!desired) return { baseHash, changes: [{ op: "remove", slot: leaf }] };
  const adopted = new Map<string, string[]>();
  const derived = new Map<string, { rule: string; inputs: readonly string[] }>();
  const authored: Record<string, DtcgToken> = {};
  for (const [id, token] of Object.entries(tokensOf(desired, leaf))) {
    const origin = token.$extensions?.["com.clossys.origin"];
    if (!origin) throw new TypeError("Studio history has no exact member provenance");
    if (origin.kind === "adopted") adopted.set(origin.source, [...(adopted.get(origin.source) ?? []), id]);
    else if (origin.kind === "derived") derived.set(origin.rule, { rule: origin.rule, inputs: origin.inputs });
    else if (origin.kind === "authored") authored[id] = token;
    else throw new TypeError("Studio history origin is unsupported");
  }
  const groups: ChangeSet["changes"][number][] = [
    ...[...adopted].map(([source, members]) => ({ op: "adopt" as const, slot: leaf, source, members })),
    ...[...derived.values()].map(origin => ({ op: "derive" as const, slot: leaf, ...origin })),
    ...(Object.keys(authored).length ? [{ op: "author" as const, slot: leaf, tokens: authored }] : []),
  ];
  // The first upstream supplies fill metadata. Try each recorded provenance group first; the whole hash proves the result.
  for (let first = 0; first < groups.length; first++) {
    const changes: ChangeSet = { baseHash, changes: [{ op: "remove", slot: leaf }, groups[first]!, ...groups.filter((_, index) => index !== first)] };
    try { if (libraryHash(applyLibraryChange(catalog, current, changes)) === expectedHash) return changes; } catch { /* Another exact existing-operation ordering may succeed. */ }
  }
  throw new EditRefusal("invalid", "Studio history cannot restore this leaf's exact provenance with registered operations");
}

import type { CompositeCatalogData, CompositeChangeSet, CompositeLibraryData, ComponentCandidate, ComponentDocument, ComponentFile, SurfaceCandidate, SurfaceDocument, SurfaceFile, SurfaceSlot, SurfaceInputIdentity } from "../catalog-core/index.js";
import type { CompositeStudioSnapshot } from "./types.js";
const component = (doc: ComponentDocument) => Object.values(doc.components)[0]!;
const surface = (doc: SurfaceDocument) => Object.values(doc.sections ?? doc.frames ?? {})[0]!;
function ownedFiles<F extends { path: string; content: string }>(files: readonly F[], paths: readonly { path: string }[]): readonly F[] {
  const owned = new Set(paths.map(receipt => receipt.path));
  return files.filter(file => owned.has(file.path)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function mergeFiles<F extends { path: string; content: string }>(current: readonly F[], removed: readonly { path: string }[], retained: readonly { path: string }[], additions: readonly F[]): readonly F[] {
  const old = new Set(removed.map(receipt => receipt.path)), shared = new Set(retained.map(receipt => receipt.path));
  const files = new Map(current.filter(file => !old.has(file.path) || shared.has(file.path)).map(file => [file.path, file]));
  for (const file of additions) {
    if (files.has(file.path) && stable(files.get(file.path)) !== stable(file)) throw new EditRefusal("conflict", "Studio history shared file changed elsewhere");
    files.set(file.path, file);
  }
  return [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
const valuePortion = (library: CompositeLibraryData): LibraryData => ({ ...library.values, source: library.source, ...(library.adoptedAt ? { adoptedAt: library.adoptedAt } : {}) });
/** An inverse is emitted only after pure whole-graph replay exactly matches the intended leaf and preserves every unrelated byte. */
export function compositeHistoryChanges(catalog: CompositeCatalogData, current: CompositeStudioSnapshot, target: CompositeStudioSnapshot, leaf: string, expected: CompositeStudioSnapshot): CompositeChangeSet {
  if (current.library.source.id !== target.library.source.id || current.library.source.id !== expected.library.source.id) throw new TypeError("Studio history consumer differs");
  const baseHash = libraryHash(current.library);
  let changes: CompositeChangeSet;
  let expectedLibrary: CompositeLibraryData;
  if (leaf.startsWith("themes.") || leaf.startsWith("assets.")) {
    const inverse = valueHistoryChanges(catalog.values, valuePortion(current.library), valuePortion(target.library), leaf, valuePortion(expected.library));
    changes = { baseHash, changes: inverse.changes.map(change => ({ portion: "values", change })) };
    const values = applyLibraryChange(catalog.values, valuePortion(current.library), inverse);
    const { source: _source, adoptedAt: _adoptedAt, ...portion } = values;
    expectedLibrary = { ...current.library, values: portion };
  } else if (leaf.startsWith("components.")) {
    const old = current.library.components.fills.find(doc => component(doc).slot === leaf);
    const desired = target.library.components.fills.find(doc => component(doc).slot === leaf);
    const prior = expected.library.components.fills.find(doc => component(doc).slot === leaf);
    const oldPaths = old ? component(old).outputSha256 ?? [] : [];
    if (stable(old) !== stable(prior) || stable(ownedFiles(current.library.components.files, oldPaths)) !== stable(ownedFiles(expected.library.components.files, prior ? component(prior).outputSha256 ?? [] : []))) throw new EditRefusal("conflict", "Studio history leaf changed elsewhere");
    const operations: CompositeChangeSet["changes"][number][] = [];
    if (!desired) operations.push({ portion: "components", change: { op: "remove", slot: leaf } });
    else {
      const { origin, ...fill } = component(desired);
      if (origin.kind === "adopted") operations.push({ portion: "components", change: { op: "adopt", slot: leaf, source: origin.source } });
      else if (origin.kind === "derived") operations.push({ portion: "components", change: { op: "derive", slot: leaf, rule: origin.rule, inputs: origin.inputs } });
      else if (origin.kind === "composed") operations.push({ portion: "components", change: { op: "compose", slot: leaf, rule: origin.rule } });
      else operations.push({ portion: "components", change: { op: "author", slot: leaf, fill: fill as ComponentCandidate, files: ownedFiles(target.library.components.files, fill.outputSha256 ?? []) } });
    }
    changes = { baseHash, changes: operations, ...(current.bundles ? { bundles: current.bundles } : {}) };
    const fills = [...current.library.components.fills.filter(doc => component(doc).slot !== leaf), ...(desired ? [desired] : [])].sort((a, b) => component(a).slot.localeCompare(component(b).slot));
    const files: readonly ComponentFile[] = mergeFiles(current.library.components.files, oldPaths, fills.filter(doc => component(doc).slot !== leaf).flatMap(doc => component(doc).outputSha256 ?? []), desired ? ownedFiles(target.library.components.files, component(desired).outputSha256 ?? []) : []);
    const selection = { version: 2 as const, consumer: current.library.source.id, slots: fills.map(doc => { const fill = component(doc); return { slot: fill.slot, originKinds: [fill.origin.kind], sources: [fill.origin.kind === "adopted" ? fill.origin.source : current.library.source.id] }; }) };
    expectedLibrary = { ...current.library, components: { ...current.library.components, fills, files, selection } };
  } else {
    const slot = leaf as SurfaceSlot;
    const old = current.library.surfaces?.fills.find(doc => surface(doc).slot === leaf);
    const desired = target.library.surfaces?.fills.find(doc => surface(doc).slot === leaf);
    const prior = expected.library.surfaces?.fills.find(doc => surface(doc).slot === leaf);
    const oldPaths = old ? surface(old).outputSha256 : [];
    if (stable(old) !== stable(prior) || stable(ownedFiles(current.library.surfaces?.files ?? [], oldPaths)) !== stable(ownedFiles(expected.library.surfaces?.files ?? [], prior ? surface(prior).outputSha256 : []))) throw new EditRefusal("conflict", "Studio history leaf changed elsewhere");
    let change: import("../catalog-core/index.js").SurfaceOperation;
    if (!desired) change = { op: "remove", slot };
    else {
      const { origin, ...fill } = surface(desired);
      if (origin.kind === "adopted") change = { op: "adopt", slot, source: origin.base.source };
      else if (origin.kind === "derived") change = { op: "derive", slot, rule: origin.rule.id, inputs: origin.inputs.map((input: SurfaceInputIdentity) => input.input) };
      else change = { op: "author", slot, fill: fill as SurfaceCandidate, files: ownedFiles(target.library.surfaces?.files ?? [], fill.outputSha256), ...(origin.note !== undefined ? { note: origin.note } : {}) };
    }
    changes = { baseHash, changes: [{ portion: "surfaces", change }], ...(current.surfaceBundles ? { surfaceBundles: current.surfaceBundles } : {}) };
    const fills = [...(current.library.surfaces?.fills ?? []).filter(doc => surface(doc).slot !== leaf), ...(desired ? [desired] : [])].sort((a, b) => surface(a).slot.localeCompare(surface(b).slot));
    const files: readonly SurfaceFile[] = mergeFiles(current.library.surfaces?.files ?? [], oldPaths, fills.filter(doc => surface(doc).slot !== leaf).flatMap(doc => surface(doc).outputSha256), desired ? ownedFiles(target.library.surfaces?.files ?? [], surface(desired).outputSha256) : []);
    expectedLibrary = { ...current.library, surfaces: { version: 1, fills, files } };
  }
  const next = applyLibraryChange(catalog, current.library, changes, current.surfaceOptions ? { componentOptions: current.componentOptions, surfaceOptions: current.surfaceOptions } : undefined);
  if (libraryHash(next) !== libraryHash(expectedLibrary)) throw new EditRefusal("invalid", "Studio history cannot restore exact leaf, file ownership and provenance with registered operations");
  return changes;
}
