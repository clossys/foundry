/** Studio rendering reports legacy evidence; the catalog and publication APIs remain strict. */
import { resolve, stableStringify, type CompositeEngineInput, type CompositeResolved, type SurfaceSourceBundle } from '@clossys/designer/catalog';
import { agentModule } from './cells.js';
import { themeHash } from './theme-default.js';

export interface StudioGateReport { gate: string; blocking: false; state: 'reported' | 'unavailable'; message: string }
export type StudioReportSink = (report: StudioGateReport) => void;
export const STUDIO_SUSPENDED_GATES = ['S1-S8', 'DF', 'specimen-certificates', 'registered-upstream-checksums', 'render-cell-confirmations', 'foreign-reference-counter', 'LeafFreeze', 'CENSUS'] as const;
export function reportStudioGate(report: StudioReportSink, gate: string, error: unknown): void {
  report({ gate, blocking: false, state: 'unavailable', message: error instanceof Error ? error.message : String(error) });
}
export function isSuspendedStudioError(error: unknown): boolean {
  return /(?:surfaces: S[1-8]\b|Native specimen source evidence unavailable|LEAF_FREEZE|Invalid confirmation)/.test(error instanceof Error ? error.message : String(error));
}
export async function studioEvidence<T>(gate: string, run: () => Promise<T>, fallback: () => T | Promise<T>, report: StudioReportSink): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (!isSuspendedStudioError(error)) throw error;
    reportStudioGate(report, gate, error);
    return await fallback();
  }
}
/** Hash real render inputs without treating a provenance check as a prerequisite to hashing. */
export const studioRenderHash = (value: unknown): string => themeHash(stableStringify(value));

/** Read only the executable address; strict closed-schema/provenance findings are reported separately. */
function renderEntry(document: any): any {
  const slot = document?.$extensions?.['com.clossys.fill']?.slot;
  if (typeof slot !== 'string' || !/^(?:sections|frames)\.[a-z][a-z0-9-]*$/.test(slot)) throw new Error('Studio surface has no executable slot address.');
  const [kind, leaf] = slot.split('.');
  const fill = document[kind!]?.[leaf!];
  if (!fill?.impl || !['source', 'package'].includes(fill.impl.kind)) throw new Error(`Studio surface implementation is missing: ${slot}`);
  return { ...fill, slot };
}
const primary = (slot: string) => slot.slice(slot.indexOf('.') + 1).split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join('');
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Z][A-Za-z0-9]*$/.test(value);

/** Resolve executable components normally; surface qualification never decides whether Studio mounts. */
export async function resolveStudioRender(input: CompositeEngineInput, report: StudioReportSink): Promise<CompositeResolved> {
  try {
    const profile = resolve(input);
    for (const finding of profile.surfaces?.check.findings ?? []) report({ gate: finding.code, blocking: false, state: 'reported', message: finding.message });
    return profile;
  } catch (error) {
    if (!isSuspendedStudioError(error)) throw error;
    reportStudioGate(report, 'S1-S8', error);
  }
  const { surfaces, ...library } = input.library;
  const profile = resolve({ ...input, library });
  if (!surfaces) return profile;
  const fills = Object.fromEntries(surfaces.fills.map(document => {
    const fill = renderEntry(document);
    const hash = studioRenderHash(document);
    // Actual projection digests, never qualification receipts or a claimed pass.
    return [fill.slot, { document, descriptorHash: hash, outputHash: studioRenderHash(surfaces.files), apiHash: studioRenderHash(fill.api ?? fill.impl), inputsHash: hash }];
  }));
  const findings = [{ code: 'S8' as const, rule: 'surfaces' as const, severity: 'error' as const, subject: profile.consumer, message: 'Studio render projection is unqualified; strict surface resolution failed. See gateReports.' }];
  return { ...profile, selectionHash: studioRenderHash(input.library), surfaces: { version: 1, consumer: profile.consumer, selectionHash: studioRenderHash(input.library), fills, files: surfaces.files, check: { ok: false, findings } }, check: { ok: false, findings: [...profile.check.findings, ...findings] } };
}

/** Emit selected source without changing or forging the profile's failed check result. */
export async function emitStudioSurfaces(profile: NonNullable<CompositeResolved['surfaces']>, report: StudioReportSink): Promise<{ path: string; contents: string }[]> {
  for (const finding of profile.check.findings) report({ gate: finding.code, blocking: false, state: 'reported', message: finding.message });
  const files: { path: string; contents: string }[] = [], root: string[] = [], names = new Set<string>();
  for (const row of Object.values(profile.fills)) {
    const fill = renderEntry(row.document), name = primary(fill.slot), directory = fill.slot.replace('.', '/');
    if (names.has(name)) throw new Error(`Studio executable export is ambiguous: ${name}`);
    names.add(name);
    if (!identifier(fill.impl.export)) throw new Error(`Studio executable export is invalid: ${fill.slot}`);
    if (fill.impl.kind === 'package') {
      if (typeof fill.impl.module !== 'string' || !/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+(?:\/[A-Za-z0-9_-]+)*$/.test(fill.impl.module)) throw new Error(`Studio executable package address is invalid: ${fill.slot}`);
      files.push({ path: `${directory}/index.ts`, contents: `export { ${fill.impl.export} as ${name} } from ${JSON.stringify(fill.impl.module)};\n` });
    } else {
      if (typeof fill.impl.entry !== 'string' || !fill.impl.entry.startsWith(directory + '/') || fill.impl.entry.split('/').some((part: string) => ['.', '..'].includes(part)) || !/\.tsx?$/.test(fill.impl.entry)) throw new Error(`Studio executable source address is invalid: ${fill.slot}`);
      if (!profile.files.some(file => file.path === fill.impl.entry)) throw new Error(`Studio executable source is missing: ${fill.impl.entry}`);
      const request = './' + fill.impl.entry.slice(directory.length + 1).replace(/\.tsx?$/, '.js');
      const exports = fill.api?.exports ?? [{ name, export: fill.impl.export }];
      if (!Array.isArray(exports) || !exports.length || exports.some((entry: any) => !identifier(entry.name) || !identifier(entry.export))) throw new Error(`Studio executable API is unavailable: ${fill.slot}`);
      files.push({ path: `${directory}/index.ts`, contents: exports.map((entry: any) => `export { ${entry.export} as ${entry.name} } from ${JSON.stringify(request)};\n`).join('') });
    }
    root.push(`export { ${name} } from "./${directory}/index.js";\n`);
  }
  files.push({ path: 'surface-index.ts', contents: root.join('') }, ...profile.files.map(file => ({ path: file.path, contents: file.content })));
  return files;
}

/** A source projection for Studio defaults; it does not adopt, sign or rewrite a consumer cell. */
export async function studioSurfaceDefaults(input: CompositeEngineInput, changes: readonly { change: { slot: string; source: string } }[], bundles: readonly SurfaceSourceBundle[], report: StudioReportSink): Promise<CompositeEngineInput['library']> {
  const library = structuredClone(input.library);
  library.surfaces ??= { version: 1, fills: [], files: [] };
  const nativeApi = await agentModule('designer', 'importers/specimen-sections.js');
  const native = nativeApi.specimenSectionSourceCatalog();
  for (const { change } of changes) {
    const bundle = bundles.find(row => row.slot === change.slot);
    const candidates = input.catalog.surfaces!.fills.filter(row => row.$extensions['com.clossys.fill'].slot === change.slot && row.$extensions['com.clossys.fill'].source === change.source);
    if (!bundle && candidates.length !== 1) throw new Error(`Studio source is ambiguous or missing for ${change.slot}`);
    // A render candidate can lack an installed origin. Keep that fact in its
    // bytes; the strict resolver reports it, and no persistent library is written.
    const document = (bundle?.document ?? candidates[0]!) as unknown as NonNullable<CompositeEngineInput['library']['surfaces']>['fills'][number];
    const fill = renderEntry(document);
    let files = bundle?.files ?? [];
    if (!bundle && fill.impl.kind === 'source') {
      const source = native.upstream.find((file: { path: string }) => file.path === fill.impl.entry);
      if (!source) throw new Error(`Studio default source is missing: ${fill.impl.entry}`);
      files = [source];
    }
    library.surfaces.fills = [...library.surfaces.fills.filter(row => row.$extensions['com.clossys.fill'].slot !== change.slot), document];
    for (const file of files) {
      const prior = library.surfaces.files.find(row => row.path === file.path);
      if (prior && prior.content !== file.content) throw new Error(`Studio source collision for ${file.path}`);
      if (!prior) library.surfaces.files = [...library.surfaces.files, file];
    }
  }
  report({ gate: 'S1-S8', blocking: false, state: 'reported', message: 'Studio defaults use selected source; adoption and qualification remain unclaimed.' });
  return library;
}
