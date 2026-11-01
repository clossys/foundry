/** Detail inputs only; gallery rendering has its own projection. */
import type { SlotDetail, DetailCandidate } from '../../src/server/slot-detail';
import type { StudioLinks } from './agent-library';
import type { SpecimenInput } from '../sections/studio-specimen';
import type { OptionsInput } from '../sections/studio-options';
import { specimenHref } from './designer-library';
import { publisherFrameUrl, safePreviewUrl, type PublicationResponse } from './publisher-preview';

const text = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value) ?? '';

/** Preserve full Writer strings, including line breaks and locale/key identity. */
export function detailStrings(content: string): { key: string; text: string }[] {
  const rows: { key: string; text: string }[] = [];
  let locale = '', key = '', lines: string[] = [];
  const flush = () => {
    // Markdown record separators are blank lines; spaces inside a string are content.
    while (lines[0] === '') lines.shift();
    while (lines.at(-1) === '') lines.pop();
    if (key) rows.push({ key: locale ? `${locale}/${key}` : key, text: lines.join('\n') });
    lines = [];
  };
  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) { flush(); key = ''; locale = line.slice(3); }
    else if (line.startsWith('### ')) { flush(); key = line.slice(4); }
    else if (!/^<!-- .* -->$/.test(line)) lines.push(line);
  }
  flush();
  return rows;
}

function candidateRows(candidate: DetailCandidate, writer: boolean) {
  const strings = writer ? detailStrings(candidate.content) : [];
  return strings.length ? strings : [{ key: candidate.name, text: candidate.content }];
}

export function slotDetailInputs(detail: SlotDetail, links: StudioLinks, theme: 'light' | 'dark', publication?: PublicationResponse): Record<string, unknown> {
  const shown = detail.candidates.find(candidate => candidate.name === detail.shown);
  const pinned = !!shown?.pinned;
  const statusLabel = !shown ? 'No candidate' : pinned ? 'Pinned' : detail.pin ? 'Pin unavailable' : 'No pin';
  let specimen: SpecimenInput = shown?.specimen ? {
    kind: 'viewports', name: detail.id, title: 'Specimen', description: shown.name,
    specimens: ([375, 768, 1280] as const).map(viewport => ({ viewport,
      light: specimenHref({ specimen: shown.specimen, version: shown.version }, 'light', viewport)!,
      dark: specimenHref({ specimen: shown.specimen, version: shown.version }, 'dark', viewport)!,
    })), empty: 'No candidate',
  } : {
    kind: 'record', name: detail.id, title: detail.agent === 'writer' ? 'Strings' : 'Candidate',
    description: shown ? shown.name : 'This slot has no candidate yet.',
    rows: shown ? candidateRows(shown, detail.agent === 'writer').map(row => ({ ...row, label: row.key })) : [],
    empty: 'No candidate',
  };
  if (detail.agent === 'publisher' && detail.kind === 'page' && shown) {
    let path: unknown;
    const validPin = shown.pinned && !shown.issues.length && shown.sha256 === detail.pin?.sha256;
    if (validPin) {
      try { path = JSON.parse(shown.content).path; } catch { /* A malformed record cannot identify a published page. */ }
    }
    const page = validPin && publication?.state === 'ready' ? publication.pages.find(page => page.cellId !== undefined ? page.cellId === detail.id : typeof path === 'string' && page.route === path) : undefined;
    specimen = {
      kind: 'viewports', name: detail.id, title: 'Rendered page', description: '',
      specimens: page?.emitted && safePreviewUrl(page.previewUrl) ? ([375, 768, 1280] as const).map(viewport => ({
        viewport, light: publisherFrameUrl(page, viewport, 'light'), dark: publisherFrameUrl(page, viewport, 'dark'),
      })) : [], empty: 'Publish this page to preview it.',
    };
  }
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
