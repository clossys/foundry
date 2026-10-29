import type { CopyResolution } from "@clossys/writer";
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
  if (provenance !== undefined) {
    const checked = validateStrategyProvenance(provenance);
    if (!checked.ok) throw new TypeError(checked.issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
  }
  return {
    surfaceId,
    channel,
    artifacts: artifacts.map((artifact) => ({ ...artifact })),
    ...(provenance === undefined ? {} : { provenance: { ...provenance, refs: provenance.refs.map((ref) => ({ ...ref })) } }),
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

/** Structural metadata only; freshness is checked against Strategist's active pointers. */
export function validateStrategyProvenance(value: unknown):
  | { ok: true; value: StrategyProvenance }
  | { ok: false; issues: Array<{ path: string; message: string }> } {
  const issues: Array<{ path: string; message: string }> = [];
  const object = (input: unknown): input is Record<string, unknown> => typeof input === "object" && input !== null && !Array.isArray(input);
  const fail = (path: string, message: string) => issues.push({ path, message });
  if (!object(value)) return { ok: false, issues: [{ path: "provenance", message: "Expected brief provenance object" }] };
  if (["strategyId", "revision", "records"].some(key => Object.hasOwn(value, key))) {
    return { ok: false, issues: [{ path: "provenance", message: "Legacy strategy provenance: migrate to {contract, refs: [{cell, version}], fingerprint} from publisher.launch." }] };
  }
  for (const key of Object.keys(value)) if (!["contract", "refs", "fingerprint"].includes(key)) fail(`provenance.${key}`, "Unknown provenance field");
  if (typeof value.contract !== "string" || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(value.contract)) fail("provenance.contract", "Expected a dotted brief contract id");
  if (typeof value.fingerprint !== "string" || !value.fingerprint.trim()) fail("provenance.fingerprint", "Expected a nonempty brief fingerprint");
  if (!Array.isArray(value.refs)) fail("provenance.refs", "Expected cell refs array");
  else {
    const seen = new Set<string>();
    value.refs.forEach((ref: unknown, index: number) => {
      const path = `provenance.refs[${index}]`;
      if (!object(ref)) { fail(path, "Expected {cell, version}"); return; }
      for (const key of Object.keys(ref)) if (!["cell", "version"].includes(key)) fail(`${path}.${key}`, "Unknown cell ref field");
      if (typeof ref.cell !== "string" || !/^[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*$/.test(ref.cell)) fail(`${path}.cell`, "Expected an L3 cell id");
      if (typeof ref.version !== "number" || !Number.isSafeInteger(ref.version) || ref.version < 1) fail(`${path}.version`, "Expected a positive integer cell version");
      const key = `${ref.cell}@${ref.version}`;
      if (seen.has(key)) fail(path, "Duplicate cell ref");
      seen.add(key);
    });
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as StrategyProvenance };
}
