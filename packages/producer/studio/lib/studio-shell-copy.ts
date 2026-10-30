import { resolveAdminCopyRef, type AdminCopy, type AdminCopyRef } from '@clossys/writer/admin-copy';
import type { AgentCells, CellDetail } from './cells-client';
import { writerProjection } from './writer-specimen';

export type StudioAdminCopyRef = AdminCopyRef;
export interface StudioAdminCopyData {
  state: 'loading' | 'ready' | 'missing' | 'error';
  labels: Readonly<Record<string, string>>;
  resolve(ref: StudioAdminCopyRef): { text: string } | undefined;
  issues: readonly string[];
  cells: readonly { id: string; version: number; status: string; records: number }[];
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
export function emptyStudioAdminCopy(state: 'loading' | 'missing' | 'error', issues: readonly string[] = []): StudioAdminCopyData {
  return { state, labels: {}, resolve: () => undefined, issues, cells: [] };
}
/** Active pointers win over newer drafts. With no active version, an actual draft may be previewed. */
export function studioAdminCopyRequests(index: AgentCells): { requests: { id: string; version: number }[]; issues: string[] } {
  const requests: { id: string; version: number }[] = [], issues: string[] = [];
  if (index.agent !== 'writer' || index.state !== 'ready') return { requests, issues: [index.error ?? 'Writer cells are unavailable.'] };
  const active = index.tree?.active;
  if (active !== undefined && !object(active)) return { requests, issues: ['Writer active-version metadata is invalid.'] };
  for (const cell of index.cells) {
    const hasPointer = object(active) && Object.hasOwn(active, cell.id);
    const pointed = hasPointer ? active[cell.id] : undefined;
    if (hasPointer) {
      if (version(pointed)) requests.push({ id: cell.id, version: pointed });
      else issues.push(`Writer active-version pointer is invalid: ${cell.id}`);
    } else if (cell.status !== 'retired') {
      if (version(cell.version)) requests.push({ id: cell.id, version: cell.version });
      else issues.push(`Writer cell version is unavailable: ${cell.id}`);
    }
  }
  return { requests, issues };
}
function canonical(value: unknown): string {
  const sorted = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(sorted) : object(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : entry;
  return JSON.stringify(sorted(value));
}
/** No catalog fallback: every record and revision in the explicit Writer port comes from a loaded consumer cell. */
export function projectStudioAdminCopy(index: AgentCells, details: readonly CellDetail[], loadIssues: readonly string[] = []): StudioAdminCopyData {
  const selected = studioAdminCopyRequests(index);
  const issues = [...selected.issues, ...loadIssues];
  const candidates = new Map<string, { fingerprint: string; copy: AdminCopy }>();
  const conflicts = new Set<string>();
  const cells: { id: string; version: number; status: string; records: number }[] = [];
  for (const request of selected.requests) {
    const matches = details.filter(cell => cell.agent === 'writer' && cell.id === request.id && cell.version === request.version);
    if (matches.length !== 1) { issues.push(`Writer source version is missing or duplicated: ${request.id} version ${request.version}`); continue; }
    const cell = matches[0]!;
    if (object(index.tree?.active) && Object.hasOwn(index.tree.active, cell.id) && cell.status !== 'active') { issues.push(`Writer active-version source is not active: ${cell.id}`); continue; }
    if (cell.status !== 'active' && cell.status !== 'draft') { issues.push(`Writer source version is not available for preview: ${cell.id}`); continue; }
    const projection = writerProjection(cell);
    issues.push(...projection.gaps.map(issue => `${cell.id}: ${issue}`));
    let count = 0;
    for (const item of projection.records) {
      if (item.locale !== 'en' || typeof item.text !== 'string' || !item.text.trim()) continue;
      const record = item.record;
      if (!['draft', 'approved', 'retired'].includes(String(record.status))) { issues.push(`Writer record lifecycle is unavailable: ${item.id}`); continue; }
      const fingerprint = canonical({ locale: item.locale, record });
      const existing = candidates.get(item.id);
      if (existing && existing.fingerprint !== fingerprint) { conflicts.add(item.id); issues.push(`Writer record has conflicting source values: ${item.id}`); continue; }
      // AdminCopy's resolver reads these actual locale/revision/records fields. This
      // structural port adds no approval, activation, envelope state or package records.
      const copy = { records: [record], envelopes: [{ locale: item.locale, revision: request.version, records: [record] }] } as unknown as AdminCopy;
      if (!existing) candidates.set(item.id, { fingerprint, copy });
      count++;
    }
    cells.push({ id: cell.id, version: request.version, status: cell.status!, records: count });
  }
  for (const id of conflicts) candidates.delete(id);
  if (!candidates.size) return { ...emptyStudioAdminCopy('missing', issues), cells };
  const resolve = (ref: StudioAdminCopyRef): { text: string } | undefined => {
    const candidate = candidates.get(ref.id);
    if (!candidate) return undefined;
    try {
      const result = resolveAdminCopyRef(ref, candidate.copy, { target: 'preview' });
      return result && result.text.trim() ? { text: result.text } : undefined;
    } catch { return undefined; }
  };
  const labels = Object.fromEntries([...candidates.keys()].flatMap(id => { const value = resolve({ id }); return value ? [[id, value.text]] : []; }));
  return { state: 'ready', labels, resolve, issues, cells };
}
