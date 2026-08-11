import type { CopyResolution } from "@vespeneventures/copy";
import type { ResolvedSurfaceDocument } from "./resolve-surface.js";
import type { Channel, CopyProvenance, OutputArtifact, OutputManifest, StrategyProvenance, SurfaceDocument } from "./types.js";

/**
 * Creates the serialisable hand-off from a surface renderer to a consumer's
 * publisher. It deliberately records paths and media types only; writing,
 * uploading, and ownership of the resulting files remain consumer concerns.
 */
export function createOutputManifest(
  surfaceId: string,
  channel: Channel,
  artifacts: readonly OutputArtifact[],
  provenance?: StrategyProvenance,
): OutputManifest {
  return {
    surfaceId,
    channel,
    artifacts: artifacts.map((artifact) => ({ ...artifact })),
    ...(provenance === undefined ? {} : { provenance: { ...provenance, records: provenance.records.map((record) => ({ ...record })) } }),
  };
}

/**
 * Reduces resolved entries to deterministic, registry-level provenance.
 * Resolved copy and interpolation values are intentionally excluded: a
 * manifest is publication metadata, not another copy store.
 */
export function collectCopyProvenance(resolutions: readonly CopyResolution[]): CopyProvenance[] {
  const byRegistry = new Map<string, CopyProvenance>();
  for (const resolution of resolutions) {
    const key = JSON.stringify([resolution.recordId, resolution.revision, resolution.locale, resolution.source.kind, resolution.source.reference]);
    const current = byRegistry.get(key);
    if (current !== undefined) {
      if (!current.entryIds.includes(resolution.entryId)) current.entryIds.push(resolution.entryId);
      continue;
    }
    byRegistry.set(key, {
      recordId: resolution.recordId,
      revision: resolution.revision,
      locale: resolution.locale,
      source: { ...resolution.source },
      entryIds: [resolution.entryId],
    });
  }

  return [...byRegistry.values()]
    .map((provenance) => ({ ...provenance, entryIds: [...provenance.entryIds].sort() }))
    .sort((left, right) => {
      const leftKey = `${left.recordId}\u0000${left.revision}\u0000${left.locale}\u0000${left.source.kind}\u0000${left.source.reference}`;
      const rightKey = `${right.recordId}\u0000${right.revision}\u0000${right.locale}\u0000${right.source.kind}\u0000${right.source.reference}`;
      return leftKey.localeCompare(rightKey);
    });
}

/**
 * Creates the normal publisher hand-off from the exact canonical surface
 * and successful resolution that rendered it. It records the approved copy
 * entries used without serialising audience language.
 */
export function createResolvedOutputManifest(
  surface: SurfaceDocument,
  resolved: ResolvedSurfaceDocument,
  artifacts: readonly OutputArtifact[],
  provenance?: StrategyProvenance,
): OutputManifest {
  if (resolved.document.id !== surface.id || resolved.document.channel !== surface.channel) {
    throw new TypeError("createResolvedOutputManifest: resolved document must belong to the supplied surface.");
  }
  return {
    ...createOutputManifest(surface.id, surface.channel, artifacts, provenance),
    copy: collectCopyProvenance(resolved.resolutions),
  };
}
