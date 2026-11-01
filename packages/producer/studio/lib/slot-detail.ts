/** Detail inputs only; gallery rendering has its own projection. */
import type { SlotDetail, DetailCandidate } from '../../src/server/slot-detail';
import type { StudioLinks } from './agent-library';
import type { SpecimenInput } from '../sections/studio-specimen';
import type { OptionsInput } from '../sections/studio-options';
import { specimenHref } from './designer-library';
import { agentSpecimenTables } from './agent-library';
import { writerKindSpecimen } from '../../src/server/writer-specimen-kinds';

const text = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value) ?? '';

/** Preserve full Writer strings, including line breaks and locale/key identity. */
export function detailStrings(content: string): { key: string; text: string }[] {
  const rows: { key: string; text: string }[] = [];
  let locale = '', key = '', lines: string[] = [];
  const flush = () => {
    // Writer's grammar adds one separator; other blank lines belong to the text.
    if (lines.at(-1) === '') lines.pop();
    if (key) rows.push({ key: locale ? `${locale}/${key}` : key, text: lines.join('\n') });
    lines = [];
  };
  // Ignore the file's final newline independently of each record's separator.
  for (const line of content.replace(/\n$/, '').split('\n')) {
    if (line.startsWith('## ')) { flush(); key = ''; locale = line.slice(3); }
    else if (line.startsWith('### ')) { flush(); key = line.slice(4); }
    // Interpret structure before unescaping, as parseWriterCell does: escaped
    // headings and comments are literal content, and one backslash is removed.
    else if (!/^<!-- .* -->$/.test(line)) lines.push(line.startsWith('\\') ? line.slice(1) : line);
  }
  flush();
  return rows;
}

function candidateRows(candidate: DetailCandidate, writer: boolean) {
  const strings = writer ? detailStrings(candidate.content) : [];
  return strings.length ? strings : [{ key: candidate.name, text: candidate.content }];
}

/** Decode only canonical textless Writer records; prose uses detailStrings. */
function structuredWriterSpecimen(id: string, candidate: DetailCandidate | undefined) {
  if (!candidate || candidate.issues.length) return undefined;
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  const lines = candidate.content.replace(/\n$/, '').split('\n');
  const records: { locale: string; record: Record<string, unknown> }[] = [];
  let locale = '', firstLocale: string | undefined, i = 0;
  while (i < lines.length) {
    const line = lines[i++]!;
    if (line === '') continue;
    if (line.startsWith('## ')) { locale = line.slice(3); firstLocale ??= locale; continue; }
    if (!locale || !line.startsWith('### ') || !line.slice(4)) return undefined;
    const context = line.slice(4), metadata = /^<!-- (.+) -->$/.exec(lines[i++] ?? '');
    if (!metadata) return undefined;
    const content: string[] = [];
    while (i < lines.length && !/^#{2,3} /.test(lines[i]!)) content.push(lines[i++]!);
    if (content.at(-1) === '') content.pop();
    // Check the raw fence before decoding escapes: a literal \\```json is prose.
    if (content[0] !== '```json' || content.at(-1) !== '```') return undefined;
    let meta: unknown, record: unknown;
    try { meta = JSON.parse(metadata[1]!); record = JSON.parse(content.slice(1, -1).join('\n')); }
    catch { return undefined; }
    if (!object(meta) || typeof meta.id !== 'string' || Object.hasOwn(meta, 'text') || Object.hasOwn(meta, 'context')) return undefined;
    const bindings = meta.bindings ?? [];
    if (!Array.isArray(bindings) || bindings.some(binding => !object(binding) || Object.hasOwn(binding, 'recordId'))) return undefined;
    if (!object(record) || Object.hasOwn(record, 'text') || record.id !== meta.id || record.context !== context) return undefined;
    records.push({ locale, record });
  }
  // Match the existing Writer adapter's primary-locale table selection.
  return writerKindSpecimen(id, records.filter(row => row.locale === firstLocale).map(row => row.record));
}

export function slotDetailInputs(detail: SlotDetail, links: StudioLinks, theme: 'light' | 'dark'): Record<string, unknown> {
  const shown = detail.candidates.find(candidate => candidate.name === detail.shown);
  const pinned = !!shown?.pinned;
  const statusLabel = !shown ? 'No candidate' : pinned ? 'Pinned' : detail.pin ? 'Pin unavailable' : 'No pin';
  const structured = detail.agent === 'writer' ? structuredWriterSpecimen(detail.id, shown) : undefined;
  const specimen: SpecimenInput = shown?.specimen ? {
    kind: 'viewports', name: detail.id, title: 'Specimen', description: shown.name,
    specimens: ([375, 768, 1280] as const).map(viewport => ({ viewport,
      light: specimenHref({ specimen: shown.specimen, version: shown.version }, 'light', viewport)!,
      dark: specimenHref({ specimen: shown.specimen, version: shown.version }, 'dark', viewport)!,
    })), empty: 'No candidate',
  } : {
    kind: 'record', name: detail.id, title: detail.agent === 'writer' ? 'Strings' : 'Candidate',
    description: shown ? shown.name : 'This slot has no candidate yet.',
    rows: shown ? candidateRows(shown, detail.agent === 'writer').map(row => ({ ...row, label: row.key })) : [],
    ...(structured ? { description: structured.summary, rows: [], tables: agentSpecimenTables(structured.tables, links) } : {}),
    empty: 'No candidate',
  };
  const options: OptionsInput = {
    name: detail.id, description: detail.pin ? 'Recorded candidates beside the pin.' : 'No pin. Candidates await approval.',
    rows: [...detail.candidates].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.version - b.version).map(candidate => ({
      version: candidate.version, pinned: candidate.pinned, label: candidate.name, reason: candidate.pinned ? 'Pinned' : 'Unpinned',
      preview: candidate.specimen ? { kind: 'frame' as const, viewport: 1280 as const, src: specimenHref({ specimen: candidate.specimen, version: candidate.version }, theme, 1280)! }
        : { kind: 'strings' as const, rows: candidateRows(candidate, detail.agent === 'writer').map(row => ({ ...row, change: 'same' as const })) },
    })),
  };
  const reference = (id: string, agent?: string) => {
    const target = agent ?? detail.links.find(link => link.id === id)?.agent;
    const href = target ? links.leaf(target, id) : undefined;
    return { label: id, ...(href ? { href } : {}) };
  };
  return {
    header: { name: detail.id, id: detail.id, ...(shown ? { version: shown.version } : {}), statusLabel,
      statusTone: pinned ? 'secondary' : 'outline', statusDetail: [!detail.pin ? 'No pin.' : `Pinned candidate: ${detail.pin.candidate}`],
      trail: detail.trail, galleryHref: links.gallery(detail.agent) ?? '', galleryLabel: detail.agent },
    specimen, options,
    references: { uses: detail.uses.map(id => reference(id)), usedBy: detail.usedBy.map(ref => reference(ref.id, ref.agent)),
      lineage: detail.candidates.map(candidate => ({ key: candidate.name, version: candidate.name, mode: 'Recorded source', source: candidate.source === undefined ? 'No source recorded' : text(candidate.source) })) },
    checks: detail.checks.map((check, index) => ({ key: String(index), ...check })),
    contract: { facts: [{ label: 'Kind', value: detail.kind }, ...Object.entries(detail.contract).map(([label, value]) => ({ label, value: text(value) }))],
      lists: [{ label: 'Inputs', items: detail.inputs }, { label: 'Uses', items: detail.uses }] },
    // History is pin history, rather than inferred "revises" relationships.
    history: { rows: detail.history.map(event => ({ version: Number(/-v(\d+)\./.exec(event.candidate)?.[1] ?? 0), date: event.at,
      note: `${event.candidate} · ${event.commit}`, hash: event.sha256, marks: [event.pinnedBy] })) },
  };
}

/** Null is an unknown slot; undefined means this workspace still uses legacy stores. */
export async function loadSlotDetail(agent: string, slug: string, signal: AbortSignal): Promise<SlotDetail | null | undefined> {
  const response = await fetch(`/api/slots/${encodeURIComponent(agent)}/${encodeURIComponent(slug)}`, { signal, cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Slot detail could not load (${response.status}).`);
  const value = await response.json();
  if (value?.state === 'legacy') return undefined;
  if (value?.state !== 'ready' || !value.detail || !Array.isArray(value.detail.candidates) || typeof value.detail.id !== 'string') {
    throw new Error('Slot detail response is invalid.');
  }
  return value.detail;
}
