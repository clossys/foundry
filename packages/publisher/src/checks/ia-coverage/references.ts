import { isDeepStrictEqual } from "node:util";
import type { ContentCandidate } from "../../content/model.js";
import type { CompositionSection, ContentFinding, DesignerAssetRef } from "../../content/composition.js";
import { validateComposition } from "../../content/composition.js";
import { computeContentDigest } from "../../content/digest.js";
import { validateContentRevisionIntegrity } from "../../content/revisions.js";
import { validateConsumerLibrarySnapshots } from "../../content/library.js";
import type { CoverageInput } from "./types.js";

/** Scoped projection of the existing closed-world rules; never traverses excluded page bodies. */
export function inspectReferences(candidate: ContentCandidate, input: CoverageInput, allowed: ReadonlySet<string>) {
  const findings: ContentFinding[] = [], unresolved: { target: string; message: string }[] = [], assets = new Set<string>();
  const add = (path: string, rule: string, message: string) => findings.push({ path, rule, message });
  const integrity = validateContentRevisionIntegrity(candidate);
  if (integrity.length) return { findings: [...integrity], unresolved, sections: [] as CompositionSection[], assets: [] as string[] };
  const libraries = validateConsumerLibrarySnapshots(input.libraries);
  if (libraries.length) return { findings: [...libraries], unresolved, sections: [...candidate.composition?.sections ?? []], assets: [] as string[] };
  const composition = candidate.composition;
  if (!composition) return { findings, unresolved, sections: [] as CompositionSection[], assets: [] as string[] };
  findings.push(...validateComposition(composition));
  if (findings.length) return { findings, unresolved, sections: [] as CompositionSection[], assets: [] as string[] };
  const snapshots = input.libraries.filter(row => row.consumerId === input.registry!.workspace.consumerId && row.version === composition.libraryVersion);
  const library = snapshots.length === 1 ? snapshots[0] : undefined;
  if (!library) add("composition.libraryVersion", "unavailable-library-version", "Exactly one consumer/version registration snapshot is required");
  else {
    const frames = library.frames.filter(row => row.id === composition.frame.frameId);
    if (frames.length !== 1 || !composition.frame.frameId.startsWith("frames.")) add("composition.frame.frameId", "unregistered-frame", "Frame must resolve exactly once with the correct kind");
    else if (!frames[0]!.configIds.includes(composition.frame.configId)) add("composition.frame.configId", "unregistered-frame-config", "Frame configuration is not registered");
  }
  const asset = (ref: DesignerAssetRef, path: string): void => {
    assets.add(ref.assetId);
    if (!library || ref.libraryVersion !== library.version) add(path, "asset-library-version", "Asset must use the composition library version");
    if (library && !library.assetIds.includes(ref.assetId)) add(path, "unregistered-asset", "Asset is not registered in this consumer library");
  };
  const section = (value: CompositionSection, path: string, visiting: ReadonlySet<string>): CompositionSection => {
    if (library) {
      const entries = library.sections.filter(row => row.id === value.sectionId);
      if (entries.length !== 1 || !value.sectionId.startsWith("sections.")) add(path, "unregistered-section", "Section must resolve exactly once with the correct kind");
      else if (!entries[0]!.configIds.includes(value.configId)) add(path, "unregistered-section-config", "Section configuration is not registered");
    }
    value.assets?.forEach((ref, index) => asset(ref, `${path}.assets[${index}]`));
    if (!value.ref) return value;
    const ref = value.ref, identity = JSON.stringify([ref.candidateId, ref.revision, ref.sectionKey]);
    if (visiting.has(identity)) { add(path, "section-reference-cycle", "Pinned sections must not form a cycle"); return value; }
    // Identity/ownership metadata may be read; excluded content is never inspected.
    const targets = input.registry!.candidates.filter(row => row.id === ref.candidateId);
    if (targets.length !== 1) { add(path, "unresolved-section-reference", "Pinned candidate must resolve exactly once"); return value; }
    const target = targets[0]!;
    if (!allowed.has(target.slotId)) { unresolved.push({ target: `publisher:candidate/${target.id}`, message: "Pinned source belongs to an excluded page; its body was not inspected." }); return value; }
    const snapshots = target.history.filter(row => row.revision === ref.revision);
    if (snapshots.length !== 1) { add(path, "unresolved-section-reference", "Pinned revision must resolve exactly once"); return value; }
    const snapshot = snapshots[0]!;
    try { if (snapshot.digest !== computeContentDigest(snapshot.content)) { add(path, "pinned-revision-digest", "Pinned content digest is not authentic"); return value; } }
    catch { add(path, "pinned-revision-digest", "Pinned content is not finite JSON"); return value; }
    const pinned = snapshot.content.composition, sections = pinned?.sections.filter(row => row.key === ref.sectionKey) ?? [];
    if (!pinned || sections.length !== 1) { add(path, "unresolved-section-reference", "Pinned section key must resolve exactly once"); return value; }
    const resolved = sections[0]!;
    const shape = validateComposition({ frame: composition.frame, libraryVersion: pinned.libraryVersion, sections: [resolved] });
    if (shape.length) { findings.push(...shape); return value; }
    if (pinned.libraryVersion !== composition.libraryVersion) add(path, "pinned-library-version", "Pinned section must use the root library version");
    if (resolved.sectionId !== value.sectionId || resolved.configId !== value.configId) add(path, "pinned-section-identity", "Pinned section/config must match the referencing section");
    const result = section(resolved, `${path}.ref`, new Set([...visiting, identity]));
    const order = (fields: CompositionSection["fields"]) => [...fields].sort((a, b) => `${a.locale}/${a.key}`.localeCompare(`${b.locale}/${b.key}`));
    if (value.fields.length && !isDeepStrictEqual(order(value.fields), order(result.fields))) add(path, "pinned-copy-override", "Local fields must match the exact pinned fields");
    return { ...value, fields: result.fields };
  };
  const sections = composition.sections.map((value, index) => section(value, `composition.sections[${index}]`, new Set()));
  const settings = (value: unknown, path: string): void => {
    if (Array.isArray(value)) { value.forEach((row, index) => settings(row, `${path}[${index}]`)); return; }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    if (Object.hasOwn(row, "assetId")) {
      if (Object.keys(row).some(key => !["assetId", "libraryVersion"].includes(key)) || typeof row.assetId !== "string" || typeof row.libraryVersion !== "string") add(path, "asset-reference", "Expected an exact asset/version reference");
      else asset(row as unknown as DesignerAssetRef, path);
    }
    for (const [key, entry] of Object.entries(row)) settings(entry, `${path}.${key}`);
  };
  settings(candidate.typeSettings, "typeSettings");
  for (const [key, id] of Object.entries(candidate.pageMetaAssets ?? {})) if (id) asset({ assetId: id, libraryVersion: composition.libraryVersion }, `pageMetaAssets.${key}`);
  return { findings, unresolved, sections, assets: [...assets].sort() };
}
