import type { Composition, ContentFinding, DesignerAssetRef } from "./composition.js";
import { isContentJson } from "./json.js";
import type { ContentRegistry } from "./model.js";
import { validateContentRegistry } from "./validate.js";

/** A consumer-owned registration snapshot, with config ids scoped to their owner. */
export interface ConsumerLibrarySnapshot {
  readonly consumerId: string;
  readonly version: string;
  readonly frames: readonly { readonly id: string; readonly configIds: readonly string[] }[];
  readonly sections: readonly { readonly id: string; readonly configIds: readonly string[] }[];
  readonly assetIds: readonly string[];
}

const finding = (path: string, rule: string, message: string): ContentFinding => ({ path, rule, message });
const text = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Malformed or ambiguous snapshots cannot supply registration evidence. */
export function validateConsumerLibrarySnapshots(value: unknown): readonly ContentFinding[] {
  const findings: ContentFinding[] = [];
  const add = (path: string, rule: string) => findings.push(finding(path, rule, `Invalid ${rule}`));
  if (!isContentJson(value) || !Array.isArray(value)) return [finding("libraries", "library-snapshots", "Expected a JSON array of library snapshots")];
  const versions = new Set<string>();
  value.forEach((snapshot, i) => {
    const path = `libraries[${i}]`;
    if (!object(snapshot)) { add(path, "library-snapshot"); return; }
    for (const key of ["consumerId", "version"]) if (!text(snapshot[key])) add(`${path}.${key}`, "library-identity");
    const identity = JSON.stringify([snapshot.consumerId, snapshot.version]);
    if (versions.has(identity)) add(path, "duplicate-library-version");
    versions.add(identity);
    for (const kind of ["frames", "sections"] as const) {
      const entries = snapshot[kind];
      if (!Array.isArray(entries)) { add(`${path}.${kind}`, "library-entries"); continue; }
      const ids = new Set<string>();
      entries.forEach((entry, j) => {
        const p = `${path}.${kind}[${j}]`;
        if (!object(entry)) { add(p, "library-entry"); return; }
        if (!text(entry.id)) add(`${p}.id`, "library-id");
        else { if (ids.has(entry.id)) add(`${p}.id`, "duplicate-library-id"); ids.add(entry.id); }
        if (!Array.isArray(entry.configIds) || entry.configIds.some(id => !text(id))) add(`${p}.configIds`, "library-configs");
        else if (new Set(entry.configIds).size !== entry.configIds.length) add(`${p}.configIds`, "duplicate-library-config");
      });
    }
    if (!Array.isArray(snapshot.assetIds) || snapshot.assetIds.some(id => !text(id))) add(`${path}.assetIds`, "library-assets");
    else if (new Set(snapshot.assetIds).size !== snapshot.assetIds.length) add(`${path}.assetIds`, "duplicate-library-asset");
  });
  return findings;
}

/**
 * Closed-world registration and pinned section joins only. This does not certify
 * renderer output, required copy, medium rules, or the complete Review stage.
 * typeSettings reserves objects containing assetId for exact DesignerAssetRef
 * values; nested values are inspected even when the outer reference is invalid.
 */
export function checkContentLibraryReferences(value: unknown, libraries: unknown): readonly ContentFinding[] {
  if (!isContentJson(value)) return [finding("registry", "content-json", "Expected finite, acyclic JSON records")];
  const findings = [...validateContentRegistry(value), ...validateConsumerLibrarySnapshots(libraries)];
  if (findings.length) return findings;
  const registry = value as unknown as ContentRegistry;
  const snapshots = libraries as readonly ConsumerLibrarySnapshot[];
  const candidates = new Map(registry.candidates.map(candidate => [candidate.id, candidate]));
  const add = (path: string, rule: string, message: string) => findings.push(finding(path, rule, message));

  function asset(ref: DesignerAssetRef, library: ConsumerLibrarySnapshot, path: string): void {
    if (ref.libraryVersion !== library.version) add(path, "asset-library-version", "Asset version differs from the composition library version");
    if (!library.assetIds.includes(ref.assetId)) add(path, "unregistered-asset", `Unregistered asset: ${ref.assetId}`);
  }
  function settings(value: unknown, library: ConsumerLibrarySnapshot | undefined, path: string): void {
    if (Array.isArray(value)) { value.forEach((v, i) => settings(v, library, `${path}[${i}]`)); return; }
    if (!object(value)) return;
    if (Object.hasOwn(value, "assetId")) {
      if (Object.keys(value).some(key => key !== "assetId" && key !== "libraryVersion")) add(path, "asset-reference-keys", "Asset references permit only assetId and libraryVersion");
      if (!text(value.assetId) || !text(value.libraryVersion)) add(path, "asset-reference", "Asset references require assetId and libraryVersion");
      else if (!library) add(path, "asset-library-version", "Asset reference has no composition library");
      else asset(value as unknown as DesignerAssetRef, library, path);
    }
    Object.entries(value).forEach(([key, v]) => settings(v, library, `${path}.${key}`));
  }
  function libraryFor(composition: Composition, path: string): ConsumerLibrarySnapshot | undefined {
    const library = snapshots.find(snapshot => snapshot.consumerId === registry.workspace.consumerId && snapshot.version === composition.libraryVersion);
    if (!library) add(`${path}.libraryVersion`, "unavailable-library-version", `Consumer library version unavailable: ${composition.libraryVersion}`);
    return library;
  }
  function section(composition: Composition, index: number, path: string, visiting: ReadonlySet<string>, rootVersion: string): void {
    const current = composition.sections[index]!;
    const library = libraryFor({ ...composition, libraryVersion: rootVersion }, path);
    if (library) {
      const entry = library.sections.find(entry => entry.id === current.sectionId);
      if (!entry) add(`${path}.sectionId`, "unregistered-section", `Unregistered section: ${current.sectionId}`);
      else if (!entry.configIds.includes(current.configId)) add(`${path}.configId`, "unregistered-section-config", `Config not registered for section: ${current.configId}`);
      current.fields.forEach((field, j) => field.assets?.forEach((ref, k) => asset(ref, library, `${path}.fields[${j}].assets[${k}]`)));
    }
    if (!current.ref) return;
    const ref = current.ref;
    const identity = JSON.stringify([ref.candidateId, ref.revision, ref.sectionKey]);
    if (visiting.has(identity)) { add(`${path}.ref`, "section-reference-cycle", "Pinned section reference is cyclic"); return; }
    const target = candidates.get(ref.candidateId)?.history.find(snapshot => snapshot.revision === ref.revision)?.content.composition;
    const targetIndex = target?.sections.findIndex(section => section.key === ref.sectionKey) ?? -1;
    if (!target || targetIndex < 0) { add(`${path}.ref`, "unresolved-section-reference", "Pinned candidate revision and section key must exist"); return; }
    if (target.libraryVersion !== rootVersion) add(`${path}.ref`, "pinned-library-version", "Pinned sections must use the root candidate's library version");
    const targetSection = target.sections[targetIndex]!;
    if (current.sectionId !== targetSection.sectionId || current.configId !== targetSection.configId) add(`${path}.ref`, "pinned-section-identity", "Referencing section and config ids must match the pinned section");
    section(target, targetIndex, `${path}.ref`, new Set([...visiting, identity]), rootVersion);
  }
  registry.candidates.forEach((candidate, i) => {
    const path = `registry.candidates[${i}]`;
    const composition = candidate.composition;
    if (!composition) { settings(candidate.typeSettings, undefined, `${path}.typeSettings`); return; }
    const library = libraryFor(composition, `${path}.composition`);
    if (library) {
      const frame = library.frames.find(entry => entry.id === composition.frame.frameId);
      if (!frame) add(`${path}.composition.frame.frameId`, "unregistered-frame", `Unregistered frame: ${composition.frame.frameId}`);
      else if (!frame.configIds.includes(composition.frame.configId)) add(`${path}.composition.frame.configId`, "unregistered-frame-config", `Config not registered for frame: ${composition.frame.configId}`);
    }
    composition.sections.forEach((_section, j) => section(composition, j, `${path}.composition.sections[${j}]`, new Set(), composition.libraryVersion));
    settings(candidate.typeSettings, library, `${path}.typeSettings`);
  });
  return findings;
}
