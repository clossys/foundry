import { validateComposition } from "../composition.js";
import type { CompositionSection, ContentFinding, DesignerAssetRef } from "../composition.js";
import { checkContentLibraryReferences, validateConsumerLibrarySnapshots } from "../library.js";
import type { ReviewContext, ReviewLibrarySnapshot, ReviewSectionRegistration, ResolvedReviewSection } from "./types.js";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
const sameFields = (a: CompositionSection["fields"], b: CompositionSection["fields"]): boolean => {
  const rows = (fields: CompositionSection["fields"]) => fields.map(field => JSON.stringify([field.key, field.locale, field.value, field.source])).sort();
  return JSON.stringify(rows(a)) === JSON.stringify(rows(b));
};

/** Resolve only declared registrations and exact historical section references. */
export function reviewReferences(ctx: ReviewContext): readonly ResolvedReviewSection[] {
  const { registry, candidate, input } = ctx;
  const candidateIndex = registry.candidates.indexOf(candidate);
  const candidatePath = `registry.candidates[${candidateIndex}]`;
  const emitted = new Set<string>();
  const add = (path: string, rule: string, message: string): void => {
    const identity = JSON.stringify([path, rule]);
    if (emitted.has(identity)) return;
    emitted.add(identity); ctx.add("closed-world", path, rule, message);
  };
  const libraryFindings = validateConsumerLibrarySnapshots(input.libraries);
  const base = [...libraryFindings, ...checkContentLibraryReferences(registry, input.libraries)];
  for (const finding of base) {
    if (/^registry\.candidates\[\d+\]/.test(finding.path)
      && finding.path !== candidatePath && !finding.path.startsWith(`${candidatePath}.`)
      && finding.rule !== "duplicate-candidate-id") continue;
    add(finding.path, finding.rule, finding.message);
  }
  const invalidLibraries = new Set(libraryFindings.flatMap(finding => {
    const index = /^libraries\[(\d+)\]/.exec(finding.path)?.[1];
    return index === undefined ? [] : [Number(index)];
  }));
  const snapshotsUsable = !libraryFindings.some(finding => finding.path === "libraries");
  const libraryFor = (version: string, path: string): ReviewLibrarySnapshot | undefined => {
    const matches = input.libraries.filter(library => library?.consumerId === registry.workspace?.consumerId && library?.version === version);
    const library = matches.length === 1 ? matches[0] : undefined;
    if (snapshotsUsable && library && !invalidLibraries.has(input.libraries.indexOf(library))) return library;
    add(`${path}.libraryVersion`, "unavailable-library-version", `Consumer library version unavailable or ambiguous: ${version}`);
    return undefined;
  };
  function asset(ref: DesignerAssetRef, library: ReviewLibrarySnapshot | undefined, path: string, allowed?: readonly string[]): void {
    const reference = text(ref.assetId) ? ref.assetId : path;
    const need = (detail: string) => ctx.need("asset", "designer", reference, detail);
    if (!library) {
      add(path, "asset-library-version", "Asset reference has no available composition library");
      need(`Register asset ${reference} in the composition's consumer library.`); return;
    }
    if (ref.libraryVersion !== library.version) {
      add(path, "asset-library-version", "Asset version differs from the composition library version");
      need(`Provide asset ${reference} for library version ${library.version}.`);
    }
    if (!library.assetIds.includes(ref.assetId)) {
      add(path, "unregistered-asset", `Unregistered asset: ${ref.assetId}`);
      need(`Register asset ${reference} in library version ${library.version}.`); return;
    }
    const kind = object(library.assetKinds) ? library.assetKinds[ref.assetId] : undefined;
    if (!text(kind)) {
      add(path, "asset-kind-metadata", `Registered asset has no declared kind: ${ref.assetId}`);
      need(`Declare the kind of asset ${reference} in library version ${library.version}.`);
    } else if (allowed && !allowed.includes(kind)) {
      add(path, "asset-kind", `Asset kind ${kind} is not allowed for this section`);
      need(`Provide asset ${reference} with an allowed kind: ${allowed.join(", ")}.`);
    }
  }
  function settings(value: unknown, library: ReviewLibrarySnapshot | undefined, path: string): void {
    if (Array.isArray(value)) { value.forEach((entry, index) => settings(entry, library, `${path}[${index}]`)); return; }
    if (!object(value)) return;
    if (Object.hasOwn(value, "assetId")) {
      if (Object.keys(value).some(key => key !== "assetId" && key !== "libraryVersion")) add(path, "asset-reference-keys", "Asset references permit only assetId and libraryVersion");
      if (!text(value.assetId) || !text(value.libraryVersion)) {
        add(path, "asset-reference", "Asset references require assetId and libraryVersion");
        ctx.need("asset", "designer", text(value.assetId) ? value.assetId : path, `Provide an exact asset id and library version at ${path}.`);
      } else asset(value as unknown as DesignerAssetRef, library, path);
    }
    Object.entries(value).forEach(([key, entry]) => settings(entry, library, `${path}.${key}`));
  }
  function registration(section: CompositionSection, library: ReviewLibrarySnapshot | undefined, path: string): ReviewSectionRegistration | undefined {
    const entry = library?.sections.find(entry => entry.id === section.sectionId);
    if (!entry) {
      if (library) add(`${path}.sectionId`, "unregistered-section", `Unregistered section: ${section.sectionId}`);
      ctx.need("section", "designer", section.sectionId, `Register section ${section.sectionId} in library version ${candidate.composition?.libraryVersion ?? "unavailable"}.`);
    } else if (!entry.configIds.includes(section.configId)) {
      add(`${path}.configId`, "unregistered-section-config", `Config not registered for section: ${section.configId}`);
      ctx.need("config", "designer", `${section.sectionId}:${section.configId}`, `Register config ${section.configId} for section ${section.sectionId}.`);
    }
    const config = Array.isArray(entry?.configSchemas) ? entry.configSchemas.find(schema => schema?.configId === section.configId) : undefined;
    const allowed = config?.assetKinds ?? entry?.assetKinds;
    if (allowed !== undefined && (!Array.isArray(allowed) || allowed.some(kind => !text(kind)))) {
      add(path, "section-asset-kinds", "Section asset kinds must be an explicit array of nonblank kinds");
      ctx.need("config", "designer", `${section.sectionId}:${section.configId}`, `Declare valid allowed asset kinds for section ${section.sectionId} config ${section.configId}.`);
    }
    section.assets?.forEach((ref, index) => asset(ref, library, `${path}.assets[${index}]`, Array.isArray(allowed) ? allowed : undefined));
    return entry?.configIds.includes(section.configId) ? entry : undefined;
  }
  const composition = candidate.composition;
  if (!composition) { settings(candidate.typeSettings, undefined, `${candidatePath}.typeSettings`); return []; }
  // Structural errors are already reported by the shared checker. They must not
  // make the independent checks dereference malformed records.
  if (validateComposition(composition).length) {
    settings(candidate.typeSettings, undefined, `${candidatePath}.typeSettings`); return [];
  }
  const compositionPath = `${candidatePath}.composition`;
  const library = libraryFor(composition.libraryVersion, compositionPath);
  const frame = library?.frames.find(frame => frame.id === composition.frame.frameId);
  if (!frame) {
    if (library) add(`${compositionPath}.frame.frameId`, "unregistered-frame", `Unregistered frame: ${composition.frame.frameId}`);
    ctx.need("frame", "designer", `${composition.libraryVersion}:${composition.frame.frameId}`, `Register frame ${composition.frame.frameId} in library version ${composition.libraryVersion}.`);
  } else if (!frame.configIds.includes(composition.frame.configId)) {
    add(`${compositionPath}.frame.configId`, "unregistered-frame-config", `Config not registered for frame: ${composition.frame.configId}`);
    ctx.need("config", "designer", `${frame.id}:${composition.frame.configId}`, `Register config ${composition.frame.configId} for frame ${frame.id}.`);
  }
  settings(candidate.typeSettings, library, `${candidatePath}.typeSettings`);

  function resolve(section: CompositionSection, path: string, visiting: ReadonlySet<string>): ResolvedReviewSection | undefined {
    const entry = registration(section, library, path);
    if (!section.ref) return { section, path, library, registration: entry };
    const ref = section.ref;
    const identity = JSON.stringify([ref.candidateId, ref.revision, ref.sectionKey]);
    const gap = (rule: string, message: string): void => {
      add(`${path}.ref`, rule, message);
      ctx.need("section", "designer", identity, `Resolve pinned section ${ref.candidateId}@${ref.revision}:${ref.sectionKey}. ${message}`);
    };
    if (visiting.has(identity)) { gap("section-reference-cycle", "Pinned section reference is cyclic"); return undefined; }
    const targets = registry.candidates.filter(target => target?.id === ref.candidateId);
    const revisions = targets.length === 1 && Array.isArray(targets[0]!.history) ? targets[0]!.history.filter(snapshot => snapshot?.revision === ref.revision) : [];
    const pinned = revisions.length === 1 ? revisions[0]!.content?.composition : undefined;
    const sections = Array.isArray(pinned?.sections) ? pinned.sections.filter((target: CompositionSection) => target?.key === ref.sectionKey) : [];
    if (!pinned || sections.length !== 1) { gap("unresolved-section-reference", "Pinned candidate revision and section key must exist uniquely"); return undefined; }
    const target = sections[0]!;
    const shapeFindings: readonly ContentFinding[] = validateComposition({ libraryVersion: pinned.libraryVersion, frame: composition!.frame, sections: [target] });
    if (shapeFindings.length) {
      for (const finding of shapeFindings) add(`${path}.ref.${finding.path}`, finding.rule, finding.message);
      gap("unresolved-section-reference", "Pinned section must have a valid composition contract"); return undefined;
    }
    let compatible = true;
    if (pinned.libraryVersion !== composition!.libraryVersion) {
      gap("pinned-library-version", "Pinned sections must use the root candidate's library version"); compatible = false;
    }
    if (section.sectionId !== target.sectionId || section.configId !== target.configId) {
      gap("pinned-section-identity", "Referencing section and config ids must match the pinned section"); compatible = false;
    }
    const resolved = resolve(target, `${path}.ref`, new Set([...visiting, identity]));
    if (!resolved || !compatible) return undefined;
    if (section.fields.length && !sameFields(section.fields, resolved.section.fields)) add(`${path}.fields`, "pinned-copy-override", "Local copy differs from the exact pinned section copy");
    return { section: { ...section, fields: resolved.section.fields }, path, library, registration: entry };
  }
  return composition.sections.flatMap((section, index) => {
    const resolved = resolve(section, `${compositionPath}.sections[${index}]`, new Set());
    return resolved ? [resolved] : [];
  });
}
