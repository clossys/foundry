import { producerUrl } from './producer-url';
import { optionCopy, optionsCopy } from './options-copy';
import { checksCopy } from './checks-copy';
import { referencesCopy } from './references-copy';
import { contractCopy } from './contract-copy';
import { copyText, resolveCopy, studioCopy } from './studio-copy';
/** Detail inputs only; gallery rendering has its own projection. */
import type { SlotDetail, DetailCandidate } from '../../src/server/slot-detail';
import type { SlotCardState, SlotGalleryCard } from '../../src/server/slot-gallery';
import type { SpecimenInput } from '../sections/studio-specimen';
import type { OptionsInput } from '../sections/studio-options';
import type { HistoryInput, HistoryRow } from '../sections/studio-history';
import { publisherFrameUrl, safePreviewUrl, type PublicationPage, type PublicationResponse } from './publisher-preview';

/** Map-backed links a detail page needs: a slot's leaf route, and the tab the leaf sits in. */
export interface StudioLinks {
  leaf: (agent: string, slug: string) => string | undefined;
  /** A slot's display label, from the content-map projection (the one label resolver). */
  label: (agent: string, slug: string) => string | undefined;
  back: { href: string; label: string };
}

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

/**
 * A candidate's Writer strings, parsed by structure; the Key column shows each record's Writer key
 * (data, not a label). Never the raw file text: other kinds have no rows.
 */
function candidateRows(candidate: DetailCandidate): { key: string; label: string; text: string }[] {
  return detailStrings(candidate.content).map(({ key, text }) => ({ key, label: key, text }));
}

export function slotDetailInputs(detail: SlotDetail, links: StudioLinks, theme: 'light' | 'dark', publication?: PublicationResponse): Record<string, unknown> {
  const shown = detail.candidates.find(candidate => candidate.name === detail.shown);
  const pinned = !!shown?.pinned;
  const statusLabel = !shown ? studioCopy("studio.no-candidate") : pinned ? (detail.status === "confirm" ? studioCopy("studio.confirm") : studioCopy("studio.pinned")) : detail.pin ? studioCopy("studio.pin-unavailable") : studioCopy("studio.no-pin");
  // The page this slot's pin published, when the publication emitted one: the specimen is the page itself.
  const name = links.label(detail.agent, detail.id) ?? detail.name;
  const page = shown?.pinned && !shown.issues.length && shown.sha256 === detail.pin?.sha256 && publication?.state === 'ready'
    ? publication.pages.find(row => row.cellId === detail.id && row.emitted && safePreviewUrl(row.previewUrl)) : undefined;
  const specimen = slotSpecimen({
    name, description: shown ? shown.name : studioCopy("studio.this-slot-has-no-candidate-yet"),
    state: detail.state, kind: detail.kind, options: detail.candidates.length,
    // A preview (any candidate that is not the valid pin) never stands as the slot's specimen; it renders in its option row.
    ...(page ? { page } : {}), ...(shown?.specimen && !shown.preview ? { element: { specimen: shown.specimen, version: shown.version } } : {}),
    ...(shown?.record && !shown.preview ? { record: resolveCopy(shown.record) as RecordDraft } : {}),
  });
  const options: OptionsInput = {
    copy: optionsCopy(),
    name, description: detail.pin ? studioCopy("studio.recorded-candidates-beside-the-pin") : studioCopy("studio.no-pin-candidates-await-approval"),
    rows: [...detail.candidates].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.version - b.version).map(candidate => ({
      version: candidate.version, pinned: candidate.pinned, copy: optionCopy(detail.id, candidate), label: candidate.name, reason: candidate.pinned ? studioCopy("studio.pinned") : studioCopy("studio.unpinned"),
      preview: candidate.specimen ? { kind: 'frame' as const, viewport: 1280 as const, src: specimenHref({ specimen: candidate.specimen, version: candidate.version }, theme, 1280)! }
        : { kind: 'strings' as const, rows: candidateRows(candidate).map(row => ({ ...row, change: 'same' as const })) },
    })),
  };
  const reference = (id: string, agent?: string) => {
    const target = agent ?? detail.links.find(link => link.id === id)?.agent;
    const href = target ? links.leaf(target, id) : undefined;
    // A known slot shows its projected label; a reference the map does not hold shows its id as data.
    const label = target ? links.label(target, id) : undefined;
    return { label: label ?? id, ...(href ? { href } : {}) };
  };
  const checks = detail.checks.map((check, index) => ({ key: String(index), ok: check.ok, label: copyText(check.label), detail: copyText(check.detail) }));
  return {
    header: { name: links.label(detail.agent, detail.id) ?? detail.name, id: detail.id, ...(shown ? { version: shown.version, versionLabel: versionLabel(shown.version) } : {}), statusLabel,
      statusTone: pinned ? 'secondary' : 'outline', statusDetail: [!detail.pin ? studioCopy("studio.no-pin-87eb19") : studioCopy("studio.pinned-candidate", { value0: String(detail.pin.candidate) })],
      trail: detail.trail, galleryHref: links.back.href, galleryLabel: links.back.label },
    specimen, options,
    references: { copy: referencesCopy(), uses: detail.uses.map(id => reference(id)), usedBy: detail.usedBy.map(ref => reference(ref.id, ref.agent)),
      lineage: detail.candidates.map(candidate => ({ key: candidate.name, version: candidate.name, mode: studioCopy("studio.recorded-source"), source: candidate.source === undefined ? studioCopy("studio.no-source-recorded") : text(candidate.source) })) },
    checks: { rows: checks, copy: checksCopy(checks) },
    contract: { copy: contractCopy(), facts: [{ label: studioCopy("studio.kind"), value: detail.kind }, ...Object.entries(detail.contract).map(([label, value]) => ({ label, value: text(value) }))],
      lists: [{ label: studioCopy("studio.inputs"), items: detail.inputs }, { label: studioCopy("studio.uses"), items: detail.uses }] },
    // History is pin history, rather than inferred "revises" relationships.
    history: historyInput(detail.history.map(event => {
      const version = Number(/-v(\d+)\./.exec(event.candidate)?.[1] ?? 0);
      return { version, versionLabel: versionLabel(version), date: event.at, note: `${event.candidate} · ${event.commit}`, hash: event.sha256, marks: [event.decidedBy] };
    })),
  };
}

/** The history section's input: its rows and its words. */
function historyInput(rows: HistoryRow[]): HistoryInput {
  return { rows, copy: {
    title: studioCopy('studio.history'), summary: studioCopy('studio.history-count', { count: rows.length }), label: studioCopy('studio.history'),
    version: studioCopy('studio.references-version'), date: studioCopy('studio.date'), note: studioCopy('studio.note'), lineage: studioCopy('studio.references-lineage'),
    hash: studioCopy('studio.hash'), marks: studioCopy('studio.marks'),
  } };
}

/** Null is an unknown slot. */
export async function loadSlotDetail(agent: string, slug: string, signal: AbortSignal): Promise<SlotDetail | null> {
  const response = await fetch(producerUrl(`/api/slots/${encodeURIComponent(agent)}/${encodeURIComponent(slug)}`), { signal, cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(studioCopy("studio.slot-detail-could-not-load", { value0: String(response.status) }));
  const value = await response.json();
  if (value?.state !== 'ready' || !value.detail || !Array.isArray(value.detail.candidates) || typeof value.detail.id !== 'string') {
    throw new Error(studioCopy("studio.slot-detail-response-is-invalid"));
  }
  return value.detail;
}


type Viewport = 375 | 768 | 1280;
/** A record specimen before its table words are added. */
type RecordDraft = Omit<Extract<SpecimenInput, { kind: 'record' }>, 'rowsCopy'>;

/** What a slot's pin produces, as the specimen section draws it. */
export interface SpecimenSource {
  name: string;
  description: string;
  /** The page the pin published (Publisher), drawn as the page itself. */
  page?: PublicationPage;
  /** The pinned Designer element, drawn by its specimen route. */
  element?: { specimen: string; version?: number };
  /** A Director brief or Writer strings pin, as record rows or lead lines. */
  record?: RecordDraft;
  /** The loader's slot state (closed union): pinned, not-needed, or rejected. */
  state: SlotCardState;
  /** The slot kind: a pinned Publisher page with no emitted page is an explicit error. */
  kind: string;
  /** Candidate files on disk, for the No pin error's description. */
  options: number;
}

/**
 * The one specimen path for every agent and layer: the detail page draws every viewport in both
 * themes; a gallery card (`card`) draws the widest one, view-only, in the current theme.
 * Its only states are a rendered specimen, Not needed (with the owner's reason) and an error
 * (No pin, pin unavailable, page not emitted, no renderer). It never draws candidate file text.
 */
export function slotSpecimen(source: SpecimenSource, card?: { theme: 'light' | 'dark'; loading: string }): SpecimenInput {
  const name = source.name;
  const heading = (viewport: Viewport) => studioCopy('studio.viewport-heading', { viewport });
  const frames = (src: (viewport: Viewport, theme: 'light' | 'dark') => string) => card
    ? [{ viewport: 1280 as const, light: src(1280, card.theme), interactive: false, heading: heading(1280), title: studioCopy('studio.specimen-frame-title', { name, viewport: 1280 }) }]
    : ([375, 768, 1280] as const).map(viewport => ({ viewport, light: src(viewport, 'light'), dark: src(viewport, 'dark'), heading: heading(viewport),
      title: studioCopy('studio.specimen-frame-title-light', { name, viewport }), darkTitle: studioCopy('studio.specimen-frame-title-dark', { name, viewport }) }));
  const head = { name: source.name, title: studioCopy("studio.specimen"), description: source.description, empty: studioCopy("studio.no-candidate"), ...(card ? { loading: card.loading } : {}) };
  const status = (label: string, tone: 'secondary' | 'destructive', description: string): SpecimenInput =>
    withRowsCopy({ name: source.name, title: head.title, description: source.description, kind: 'record', empty: label, status: { label, tone, description } });
  const state = source.state;
  // The pinned Writer key carries the reason (`Not needed: {reason}`), so the badge states the decision and the description stays the slot's own.
  if (state.state === 'not-needed') return status(studioCopy("studio.not-needed", { reason: state.notNeeded.reason }), 'secondary', source.description);
  if (state.state === 'rejected') return state.reason === 'no-pin'
    ? status(studioCopy("studio.no-pin"), 'destructive', source.options ? studioCopy("studio.no-pin-candidates-await-approval") : studioCopy("studio.this-slot-has-no-candidate-yet"))
    : status(studioCopy("studio.pin-unavailable"), 'destructive', studioCopy("studio.no-pin-87eb19"));
  if (source.page) { const page = source.page; return { ...head, kind: 'viewports', specimens: frames((viewport, theme) => publisherFrameUrl(page, viewport, theme)) }; }
  if (source.element) { const element = source.element; return { ...head, kind: 'viewports', specimens: frames((viewport, theme) => specimenHref(element, theme, viewport)!) }; }
  if (source.record) return withRowsCopy(source.record);
  // Pinned, but nothing renders it: an unemitted Publisher page or a kind with no renderer is an error.
  if (source.kind === 'page') return status(studioCopy("studio.missing"), 'destructive', studioCopy("studio.publish-this-page-to-preview-it"));
  return status(studioCopy("studio.unavailable"), 'destructive', studioCopy("studio.no-specimen-recorded-for-this-leaf-yet"));
}

/** The rows table's words: its accessible label (the slot's name) and the column headings. */
function withRowsCopy(input: RecordDraft): SpecimenInput {
  return { ...input, rowsCopy: { label: studioCopy('studio.specimen-table-label', { name: input.name }), key: studioCopy('studio.key'), content: studioCopy('studio.content') } };
}

/** A version number as Studio shows it. */
export const versionLabel = (version: number) => studioCopy('studio.version-label', { version });

/** A gallery card's specimen: the same path as the detail page, from the card data the gallery has. */
export function slotCardSpecimen(card: Pick<SlotGalleryCard, 'id' | 'kind' | 'state' | 'options' | 'status' | 'specimen' | 'version' | 'excerpt'>, label: string, theme: 'light' | 'dark', publication?: PublicationResponse): SpecimenInput {
  const active = card.status === 'active';
  const page = active && publication?.state === 'ready'
    ? publication.pages.find(row => row.cellId === card.id && row.emitted && safePreviewUrl(row.previewUrl)) : undefined;
  const head = { name: label, title: studioCopy("studio.specimen"), description: card.id };
  // A failing pinned card (invalid candidate or hash drift) is the loader's pin, but nothing it can draw.
  const state: SlotCardState = card.status === 'failing' && card.state.state === 'pinned' ? { state: 'rejected', reason: 'invalid-pin' } : card.state;
  return slotSpecimen({
    name: label, description: card.id, state, kind: card.kind, options: card.options, ...(page ? { page } : {}),
    ...(active && card.specimen ? { element: { specimen: card.specimen, version: card.version } } : {}),
    ...(active && card.excerpt.length ? { record: { ...head, kind: 'record', lead: card.excerpt, empty: studioCopy("studio.no-candidate") } } : {}),
  }, { theme, loading: label });
}
