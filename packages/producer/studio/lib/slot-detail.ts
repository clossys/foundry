import { producerUrl } from './producer-url';
import { optionCopy, optionsCopy } from './options-copy';
import { checksCopy } from './checks-copy';
import { referencesCopy } from './references-copy';
import { contractCopy } from './contract-copy';
import { studioCopy } from './studio-copy';
/** Detail inputs only; gallery rendering has its own projection. */
import type { SlotDetail, DetailCandidate } from '../../src/server/slot-detail';
import type { SpecimenInput } from '../sections/studio-specimen';
import type { OptionsInput } from '../sections/studio-options';
import { publisherFrameUrl, safePreviewUrl, type PublicationResponse } from './publisher-preview';

/** Map-backed links a detail page needs: a slot's leaf route, and the tab the leaf sits in. */
export interface StudioLinks { leaf: (agent: string, slug: string) => string | undefined; back: { href: string; label: string } }

/** A Designer specimen route for one pinned element, at one theme and width. */
export function specimenHref(card: { specimen?: string; version?: number }, theme: 'light' | 'dark', width: number): string | undefined {
  if (!card.specimen) return undefined;
  const params = new URLSearchParams({ element: card.specimen, theme, width: String(width) });
  if (card.version) params.set('v', String(card.version));
  return `/__specimen?${params}`;
}

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

function candidateRows(candidate: DetailCandidate) {
  const strings = detailStrings(candidate.content);
  return strings.length ? strings : [{ key: candidate.name, text: candidate.content }];
}

export function slotDetailInputs(detail: SlotDetail, links: StudioLinks, theme: 'light' | 'dark', publication?: PublicationResponse): Record<string, unknown> {
  const shown = detail.candidates.find(candidate => candidate.name === detail.shown);
  const pinned = !!shown?.pinned;
  const statusLabel = !shown ? studioCopy("studio.no-candidate") : pinned ? studioCopy("studio.pinned") : detail.pin ? studioCopy("studio.pin-unavailable") : studioCopy("studio.no-pin");
  // The page this slot's pin published, when the publication emitted one: the specimen is the page itself.
  const page = shown?.pinned && !shown.issues.length && shown.sha256 === detail.pin?.sha256 && publication?.state === 'ready'
    ? publication.pages.find(row => row.cellId === detail.id && row.emitted && safePreviewUrl(row.previewUrl)) : undefined;
  const viewports = (src: (viewport: 375 | 768 | 1280, theme: 'light' | 'dark') => string) => ([375, 768, 1280] as const).map(viewport => ({ viewport, light: src(viewport, 'light'), dark: src(viewport, 'dark') }));
  const specimen: SpecimenInput = page
    ? { kind: 'viewports', name: detail.id, title: studioCopy("studio.specimen"), description: shown!.name, specimens: viewports((viewport, mode) => publisherFrameUrl(page, viewport, mode)), empty: studioCopy("studio.no-candidate") }
    : shown?.specimen
      ? { kind: 'viewports', name: detail.id, title: studioCopy("studio.specimen"), description: shown.name, specimens: viewports((viewport, mode) => specimenHref({ specimen: shown.specimen, version: shown.version }, mode, viewport)!), empty: studioCopy("studio.no-candidate") }
      : shown?.record
        ? shown.record
        : {
          kind: 'record', name: detail.id, title: studioCopy("studio.candidate"),
          description: shown ? shown.name : studioCopy("studio.this-slot-has-no-candidate-yet"),
          rows: shown ? candidateRows(shown).map(row => ({ ...row, label: row.key })) : [],
          empty: detail.pin ? studioCopy("studio.pin-unavailable") : statusLabel,
        };
  const options: OptionsInput = {
    copy: optionsCopy(),
    name: detail.id, description: detail.pin ? studioCopy("studio.recorded-candidates-beside-the-pin") : studioCopy("studio.no-pin-candidates-await-approval"),
    rows: [...detail.candidates].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.version - b.version).map(candidate => ({
      version: candidate.version, pinned: candidate.pinned, copy: optionCopy(detail.id, candidate), label: candidate.name, reason: candidate.pinned ? studioCopy("studio.pinned") : studioCopy("studio.unpinned"),
      preview: candidate.specimen ? { kind: 'frame' as const, viewport: 1280 as const, src: specimenHref({ specimen: candidate.specimen, version: candidate.version }, theme, 1280)! }
        : { kind: 'strings' as const, rows: candidateRows(candidate).map(row => ({ ...row, change: 'same' as const })) },
    })),
  };
  const reference = (id: string, agent?: string) => {
    const target = agent ?? detail.links.find(link => link.id === id)?.agent;
    const href = target ? links.leaf(target, id) : undefined;
    return { label: id, ...(href ? { href } : {}) };
  };
  const checks = detail.checks.map((check, index) => ({ key: String(index), ...check }));
  return {
    header: { name: detail.id, id: detail.id, ...(shown ? { version: shown.version } : {}), statusLabel,
      statusTone: pinned ? 'secondary' : 'outline', statusDetail: [!detail.pin ? studioCopy("studio.no-pin-87eb19") : studioCopy("studio.pinned-candidate", { value0: String(detail.pin.candidate) })],
      trail: detail.trail, galleryHref: links.back.href, galleryLabel: links.back.label },
    specimen, options,
    references: { copy: referencesCopy(), uses: detail.uses.map(id => reference(id)), usedBy: detail.usedBy.map(ref => reference(ref.id, ref.agent)),
      lineage: detail.candidates.map(candidate => ({ key: candidate.name, version: candidate.name, mode: studioCopy("studio.recorded-source"), source: candidate.source === undefined ? studioCopy("studio.no-source-recorded") : text(candidate.source) })) },
    checks: { rows: checks, copy: checksCopy(checks) },
    contract: { copy: contractCopy(), facts: [{ label: studioCopy("studio.kind"), value: detail.kind }, ...Object.entries(detail.contract).map(([label, value]) => ({ label, value: text(value) }))],
      lists: [{ label: studioCopy("studio.inputs"), items: detail.inputs }, { label: studioCopy("studio.uses"), items: detail.uses }] },
    // History is pin history, rather than inferred "revises" relationships.
    history: { rows: detail.history.map(event => ({ version: Number(/-v(\d+)\./.exec(event.candidate)?.[1] ?? 0), date: event.at,
      note: `${event.candidate} · ${event.commit}`, hash: event.sha256, marks: [event.pinnedBy] })) },
  };
}

/** Null is an unknown slot; undefined means this workspace still uses legacy stores. */
export async function loadSlotDetail(agent: string, slug: string, signal: AbortSignal): Promise<SlotDetail | null | undefined> {
  const response = await fetch(producerUrl(`/api/slots/${encodeURIComponent(agent)}/${encodeURIComponent(slug)}`), { signal, cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(studioCopy("studio.slot-detail-could-not-load", { value0: String(response.status) }));
  const value = await response.json();
  if (value?.state === 'legacy') return undefined;
  if (value?.state !== 'ready' || !value.detail || !Array.isArray(value.detail.candidates) || typeof value.detail.id !== 'string') {
    throw new Error(studioCopy("studio.slot-detail-response-is-invalid"));
  }
  return value.detail;
}
