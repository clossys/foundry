/** P0 Studio rendering reports legacy evidence; publication and the catalog API stay strict. */
import { resolve, type CompositeEngineInput, type CompositeResolved, type SurfaceSourceBundle } from '@clossys/designer/catalog';
import { agentModule } from './cells.js';

export interface StudioGateReport { gate: string; blocking: false; state: 'reported' | 'unavailable'; message: string }
export type StudioReportSink = (report: StudioGateReport) => void;
export const STUDIO_SUSPENDED_GATES = ['S1-S8', 'DF', 'specimen-certificates', 'registered-upstream-checksums', 'render-cell-confirmations', 'foreign-reference-counter', 'LeafFreeze', 'CENSUS'] as const;
export function reportStudioGate(report: StudioReportSink, gate: string, error: unknown): void {
  report({ gate, blocking: false, state: 'unavailable', message: error instanceof Error ? error.message : String(error) });
}
export async function studioEvidence<T>(gate: string, run: () => Promise<T>, fallback: () => T | Promise<T>, report: StudioReportSink): Promise<T> {
  try { return await run(); }
  catch (error) { reportStudioGate(report, gate, error); return await fallback(); }
}

/** Resolve executable components normally; surface evidence has a separate, honest report. */
export async function resolveStudioRender(input: CompositeEngineInput, report: StudioReportSink): Promise<CompositeResolved> {
  try {
    const profile = resolve(input);
    for (const finding of profile.surfaces?.check.findings ?? []) report({ gate: finding.code, blocking: false, state: 'reported', message: finding.message });
    return profile;
  } catch (error) {
    if (!/surfaces: S[1-8]\b/.test(error instanceof Error ? error.message : String(error))) throw error;
    reportStudioGate(report, 'S1-S8', error);
  }
  const { surfaces, ...library } = input.library;
  const profile = resolve({ ...input, library });
  if (!surfaces) return profile;
  const api = await agentModule('designer', 'catalog-core/surface-library.js');
  const fills = Object.fromEntries(surfaces.fills.map(document => {
    const fill = api.surfaceEntryOf(document);
    const hash = api.surfaceDigest(document);
    // These are actual projection digests, explicitly not qualification receipts.
    return [fill.slot, { document, descriptorHash: hash, outputHash: api.surfaceDigest(surfaces.files), apiHash: api.surfaceDigest(fill.api ?? fill.impl), inputsHash: hash }];
  }));
  const findings = [{ code: 'S8' as const, rule: 'surfaces' as const, severity: 'error' as const, subject: profile.consumer, message: 'Studio render projection is unqualified; strict surface resolution failed. See Studio gate reports.' }];
  return { ...profile, surfaces: { version: 1, consumer: profile.consumer, selectionHash: profile.selectionHash, fills, files: surfaces.files, check: { ok: false, findings } }, check: { ok: false, findings: [...profile.check.findings, ...findings] } };
}

/** Emit the actual selected source while leaving the stored profile's failed diagnostics intact. */
export async function emitStudioSurfaces(profile: NonNullable<CompositeResolved['surfaces']>, report: StudioReportSink) {
  for (const finding of profile.check.findings) report({ gate: finding.code, blocking: false, state: 'reported', message: finding.message });
  const api = await agentModule('designer', 'catalog-core/surface-emit.js');
  return api.emitSurfaces({ ...profile, check: { ok: true, findings: [] } }, ['surface-index']) as { path: string; contents: string }[];
}

/** Studio default adoption uses selected real bundles/package pointers, without making an approval claim. */
export async function studioSurfaceDefaults(input: CompositeEngineInput, changes: readonly { change: { slot: string; source: string } }[], bundles: readonly SurfaceSourceBundle[], report: StudioReportSink): Promise<CompositeEngineInput['library']> {
  const api = await agentModule('designer', 'catalog-core/surface-library.js');
  const library = structuredClone(input.library);
  library.surfaces ??= { version: 1, fills: [], files: [] };
  for (const { change } of changes) {
    const bundle = bundles.find(row => row.slot === change.slot);
    let document = bundle?.document;
    if (!document) {
      const candidates = input.catalog.surfaces!.fills.filter(row => row.$extensions['com.clossys.fill'].slot === change.slot && row.$extensions['com.clossys.fill'].source === change.source);
      if (candidates.length !== 1) throw new Error(`Studio source is ambiguous or missing for ${change.slot}`);
      const candidate = candidates[0]!, meta = candidate.$extensions['com.clossys.fill'];
      const fill = api.surfaceEntryOf(candidate);
      document = api.surfacePackageDocument(library, fill, { kind: 'package', source: change.source, fill: meta.id, pin: meta.pin, license: meta.license, descriptorHash: api.surfacePackageDescriptorHash(fill), adoptedAt: library.adoptedAt });
    }
    library.surfaces.fills = [...library.surfaces.fills.filter(row => row.$extensions['com.clossys.fill'].slot !== change.slot), document!];
    for (const file of bundle?.files ?? []) {
      const prior = library.surfaces.files.find(row => row.path === file.path);
      if (prior && prior.content !== file.content) throw new Error(`Studio source collision for ${file.path}`);
      if (!prior) library.surfaces.files = [...library.surfaces.files, file];
    }
  }
  report({ gate: 'S1-S8', blocking: false, state: 'reported', message: 'Studio defaults projected from real selected source; strict adoption/qualification remains available separately.' });
  return library;
}
