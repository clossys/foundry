import { checksCopy } from './checks-copy';
import { referencesCopy } from './references-copy';
import { contractCopy } from './contract-copy';
import { studioCopy } from './studio-copy';
/**
 * Studio agent library client: the Director, Writer and Publisher galleries and leaves read
 * Producer's record projection over HTTP only (`/api/agents/<agent>/library[/<leaf>]`), and one
 * adapter per agent turns it into the inputs of the Studio sections the page records place.
 * Every link resolves through the Studio map (`StudioLinks`); no route string is built here.
 */
import type { AgentGalleryInput, GalleryCardData, GalleryLayerData } from '../sections/studio-agent-gallery/types';
import type { CheckRow } from '../sections/studio-checks';
import type { ContractInput } from '../sections/studio-contract';
import type { HistoryInput } from '../sections/studio-history';
import type { LeafHeaderInput } from '../sections/studio-leaf-header';
import type { OptionRow, OptionsInput } from '../sections/studio-options';
import type { ReferenceLink, ReferencesInput } from '../sections/studio-references';
import type { SpecimenInput, ViewportSpecimen } from '../sections/studio-specimen';
import type { PageNoticeData } from '../frames/studio-shell/PageNotice';
import { optionsDescription } from './designer-library';
import { LEAF_STATUS_LABEL as STATUS_LABEL, LEAF_STATUS_TONE as STATUS_TONE, LEAF_UNIT, leafCountLabel, type LeafStatus } from './leaf-status';

export const LIBRARY_AGENTS = ['director', 'writer', 'publisher'] as const;
export type LibraryAgent = typeof LIBRARY_AGENTS[number];
export const isLibraryAgent = (value: string): value is LibraryAgent => (LIBRARY_AGENTS as readonly string[]).includes(value);

/** Map-backed links: the served path of an agent's gallery or one of its leaves, when the map has it. */
export interface StudioLinks { gallery: (agent: string) => string | undefined; leaf: (agent: string, slug: string) => string | undefined }

export type AgentLeafStatus = 'active' | 'draft' | 'retired' | 'missing' | 'failing';
export interface AgentRef { label: string; agent?: string; slug?: string }
export interface AgentCard { id: string; slug: string; name: string; version: number; status: AgentLeafStatus; excerpt: string[]; records?: number; emptyState?: 'No candidate' | 'No pin'; specimenUrl?: string }
export interface AgentSpecimenTable { id: string; label: string; columns: string[]; prose?: number; rows: { key: string; cells: { text: string; ref?: AgentRef; status?: string }[] }[] }
export interface AgentSection { id: string; label: string; level: 0 | 1 | 2; cards: AgentCard[] }
export interface AgentGalleryRecords { state: 'ready' | 'missing'; agent: LibraryAgent; grouping?: 'ia' | 'kind'; sections: AgentSection[]; count: number }
export interface AgentHistoryRow { version: number; status: AgentLeafStatus; updated: string; note: string; active: boolean }
export interface AgentLeafRecords {
  agent: LibraryAgent; card: AgentCard; trail: string[]; statusDetail: string[];
  specimen: { summary: string; rows: { label: string; text: string; ref?: AgentRef }[]; kind?: string; tables?: AgentSpecimenTable[] };
  checks: { label: string; ok: boolean; detail?: string }[];
  contract: { facts: { label: string; value: string }[]; lists: { label: string; items: string[] }[] };
  history: AgentHistoryRow[];
  uses: AgentRef[]; usedBy: AgentRef[];
}

/** Per-agent copy: the only thing that differs between the agents' galleries and leaves. */
interface AgentAdapter { label: string; description: string; specimenTitle: string }
const ADAPTERS: Record<LibraryAgent, AgentAdapter> = {
  director: { label: studioCopy("studio.director"), description: studioCopy("studio.strategy-records-grouped-by-the-strategy-catalog"), specimenTitle: studioCopy("studio.direction") },
  writer: { label: studioCopy("studio.writer"), description: studioCopy("studio.copy-cells-and-their-keys-open-one"), specimenTitle: studioCopy("studio.strings") },
  publisher: { label: studioCopy("studio.publisher"), description: studioCopy("studio.page-records-open-one-for-the-sections"), specimenTitle: studioCopy("studio.sections") },
};
export const agentLabel = (agent: LibraryAgent) => ADAPTERS[agent].label;

const KIND_TITLE: Record<string, string> = { voice: studioCopy("studio.voice"), claims: studioCopy("studio.claims"), naming: studioCopy("studio.names") };
const isLeafStatus = (value: string | undefined): value is LeafStatus => value !== undefined && value in STATUS_LABEL;
const status = (value: LeafStatus) => ({ label: STATUS_LABEL[value], tone: STATUS_TONE[value] });
/** A cell with no records has nothing to preview: the shared `missing` status says so. */
const emptyStatus = (card: AgentCard): LeafStatus | undefined => card.records === 0 ? 'missing' : undefined;
const refHref = (links: StudioLinks, ref: AgentRef) => ref.agent && ref.slug ? links.leaf(ref.agent, ref.slug) : undefined;
const toRef = (links: StudioLinks, ref: AgentRef): ReferenceLink => { const href = refHref(links, ref); return { label: ref.label, ...(href ? { href } : {}) }; };

async function request(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(studioCopy("studio.producer-could-not-load-this-agent-library", { value0: String(response.status) }));
  return response.json();
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

export async function loadAgentGallery(agent: LibraryAgent, signal: AbortSignal): Promise<AgentGalleryRecords> {
  const value = await request(`/api/agents/${agent}/library`, signal);
  if (!object(value) || !Array.isArray(value.sections) || typeof value.count !== 'number') throw new Error(studioCopy("studio.the-agent-library-response-is-invalid"));
  return value as unknown as AgentGalleryRecords;
}

export async function loadAgentLeaf(agent: LibraryAgent, slug: string, signal: AbortSignal): Promise<AgentLeafRecords | undefined> {
  const value = await request(`/api/agents/${agent}/library/${encodeURIComponent(slug)}`, signal);
  if (value === undefined) return undefined;
  if (!object(value) || value.state !== 'ready' || !object(value.leaf)) throw new Error(studioCopy("studio.the-agent-leaf-response-is-invalid"));
  return value.leaf as unknown as AgentLeafRecords;
}

export function agentNotice(agent: LibraryAgent, state: 'missing' | 'error', message?: string): PageNoticeData {
  const { label } = ADAPTERS[agent];
  return state === 'missing'
    ? { title: studioCopy("studio.no-records-yet", { value0: String(label) }), description: studioCopy("studio.producer-found-no-cells-in-this-workspace", { value0: String(label) }) }
    : { title: studioCopy("studio.agent-library-load-failed", { value0: String(label) }), description: message ?? studioCopy("studio.producer-returned-an-error") };
}

/**
 * Each leaf's gallery preview, keyed by card id: its full specimen once the loader has it, `null`
 * when its leaf could not load. A card missing from the map is still loading.
 */
export type GalleryPreviews = ReadonlyMap<string, SpecimenInput | null>;
const LOADING = { label: studioCopy("studio.loading-preview"), tone: 'outline' as const, loading: true };
const UNAVAILABLE = { label: studioCopy("studio.preview-unavailable"), tone: 'outline' as const };

/**
 * A leaf's full gallery preview: a Publisher page as its last install emitted it, framed view-only
 * at desktop width, else the record's own content (a Director brief, a Writer leaf's strings).
 */
export function agentGalleryPreview(leaf: AgentLeafRecords, links: StudioLinks, pageUrl?: string): SpecimenInput {
  if (pageUrl) return { kind: 'viewports', name: leaf.card.name, title: studioCopy("studio.rendered-page"), description: '', specimens: [{ viewport: 1280, light: pageUrl, interactive: false }], empty: studioCopy("studio.publish-this-page-to-preview-it") };
  return agentRecordSpecimen(leaf, links);
}

/** Records -> display data: L0 sections open a layer; L1/L2 sections become its groups. */
export function agentGalleryLayers(records: AgentGalleryRecords, links: StudioLinks, previews: GalleryPreviews = new Map()): GalleryLayerData[] {
  const layers: { id: string; label: string; groups: GalleryLayerData['groups'][number][] }[] = [];
  for (const section of records.sections) {
    if (section.level === 0) { layers.push({ id: section.id, label: section.label, groups: [] }); continue; }
    if (!layers.length) layers.push({ id: `${section.id}-layer`, label: section.label, groups: [] });
    layers.at(-1)!.groups.push({
      id: section.id, label: section.label, level: section.level,
      cards: section.cards.flatMap(card => {
        const href = links.leaf(records.agent, card.slug);
        const empty = emptyStatus(card);
        return [{
          key: card.id, name: card.name, ...(card.version ? { version: card.version } : {}),
          statusLabel: card.emptyState ?? STATUS_LABEL[card.status], statusTone: STATUS_TONE[card.status],
          href: href ?? '', ...previewFields(card, empty, previews),
        }];
      }),
    });
  }
  return layers.filter(layer => layer.groups.length);
}

function previewFields(card: AgentCard, empty: LeafStatus | undefined, previews: GalleryPreviews): Pick<GalleryCardData, 'specimen' | 'specimenStatus'> {
  if (card.specimenUrl && card.records !== 0) return { specimen: { kind: 'viewports', name: card.name, title: card.name, description: '', empty: card.emptyState ?? '', specimens: [{ viewport: 1280, light: card.specimenUrl, interactive: false }] } };
  if (card.emptyState && card.records === 0) return { specimenStatus: { label: card.emptyState, tone: 'outline' } };
  if (empty) return { specimenStatus: status(empty) };
  const preview = previews.get(card.id);
  if (preview) return { specimen: preview };
  return { specimenStatus: preview === null ? UNAVAILABLE : LOADING };
}

/** The `gallery` input for one agent, or a notice when it has nothing to show. `count` is the gallery's leaf entries in the Studio map. */
export function agentGalleryInput(records: AgentGalleryRecords, links: StudioLinks, count: number, previews: GalleryPreviews = new Map()): AgentGalleryInput | PageNoticeData {
  const adapter = ADAPTERS[records.agent];
  const layers = agentGalleryLayers(records, links, previews);
  if (records.state === 'missing' || !layers.length) return agentNotice(records.agent, 'missing');
  return {
    header: {
      title: studioCopy("studio.agent-library-title", { value0: String(adapter.label) }),
      description: studioCopy("studio.from-the-record-store", { value0: String(leafCountLabel(count)), value1: String(adapter.description) }),
      ...(records.grouping === 'kind' ? { notice: studioCopy("studio.grouped-by-record-kind-this-agent-has") } : {}),
    },
    unit: LEAF_UNIT, layers,
  };
}

/** The version a leaf shows: the active one, else the newest. */
export function shownVersion(leaf: AgentLeafRecords): AgentHistoryRow | undefined {
  return leaf.history.find(row => row.active) ?? leaf.history[0];
}

/**
 * Options pending approval: every version newer than the active one that is not retired, or every
 * draft when nothing is active yet. The history comes newest first.
 */
export function agentOptionVersions(leaf: AgentLeafRecords): AgentHistoryRow[] {
  const active = leaf.history.find(row => row.active);
  return leaf.history.filter(row => row.status !== 'retired' && !row.active && (active ? row.version > active.version : row.status === 'draft')).sort((a, b) => a.version - b.version);
}

/** The `options` input for an agent leaf, from per-version previews the loader prepared. */
export function agentOptionsInput(leaf: AgentLeafRecords, previews: ReadonlyMap<number, OptionRow['preview']>): OptionsInput | undefined {
  const options = agentOptionVersions(leaf);
  if (!options.length) return undefined;
  const active = leaf.history.find(row => row.active);
  const rows: OptionRow[] = [...(active ? [active] : []), ...options].map(row => ({
    version: row.version, pinned: row.active, label: row.active ? studioCopy("studio.active-v", { value0: String(row.version) }) : studioCopy("studio.option-v", { value0: String(row.version) }),
    reason: row.note || '—', preview: previews.get(row.version) ?? { kind: 'note', text: row.note || studioCopy("studio.no-note-recorded-for-this-version") },
  }));
  return {
    name: leaf.card.name,
    description: optionsDescription(Boolean(active), options.length, 'active'),
    rows,
  };
}

/** Each version's step in the chain: the first version starts it, every later one revises the one before. */
function agentLineage(leaf: AgentLeafRecords): ReferencesInput['lineage'] {
  const versions = [...leaf.history].sort((a, b) => b.version - a.version);
  return versions.map((row, index) => {
    const previous = versions[index + 1];
    return { key: `v${row.version}`, version: `v${row.version}`, mode: previous ? studioCopy("studio.revises-v", { value0: String(previous.version) }) : studioCopy("studio.first-recorded"), source: studioCopy("studio.record", { value0: String(ADAPTERS[leaf.agent].label), value1: String(row.updated) }) };
  });
}

/** The record specimen every agent leaf can show: its own content as tables or labelled rows. */
export function agentRecordSpecimen(leaf: AgentLeafRecords, links: StudioLinks): SpecimenInput {
  const adapter = ADAPTERS[leaf.agent];
  const empty = emptyStatus(leaf.card);
  return {
    kind: 'record', name: leaf.card.name, title: KIND_TITLE[leaf.specimen.kind ?? ''] ?? adapter.specimenTitle, description: leaf.specimen.summary,
    rows: leaf.specimen.rows.map((row, index) => {
      const href = row.ref ? refHref(links, row.ref) : undefined;
      return { key: `${index}`, label: row.label, text: row.text, ...(href ? { href } : {}) };
    }),
    ...(leaf.specimen.tables?.length ? { tables: leaf.specimen.tables.map(table => ({
      id: table.id, label: table.label, columns: table.columns, ...(table.prose === undefined ? {} : { prose: table.prose }),
      rows: table.rows.map(row => ({ key: row.key, cells: row.cells.map(cell => {
        const href = cell.ref ? refHref(links, cell.ref) : undefined;
        return { text: cell.text, ...(href ? { href } : {}), ...(isLeafStatus(cell.status) ? { statusLabel: STATUS_LABEL[cell.status], statusTone: STATUS_TONE[cell.status] } : {}) };
      }) })),
    })) } : {}),
    ...(empty ? { status: { ...status(empty), description: studioCopy("studio.this-cell-holds-no-records-yet-so") } } : {}),
    empty: studioCopy("studio.this-record-holds-no-content-yet"),
  };
}

/** A rendered page specimen: the installed page framed at every viewport. */
export function viewportSpecimen(leaf: AgentLeafRecords, specimens: readonly ViewportSpecimen[], description: string): SpecimenInput {
  return { kind: 'viewports', name: leaf.card.name, title: studioCopy("studio.rendered-page"), description, specimens, empty: studioCopy("studio.publish-this-page-to-preview-it") };
}

/** Every section input an agent leaf page places, display-ready. `options` and `specimen` come from the loader. */
export function agentLeafInputs(leaf: AgentLeafRecords, links: StudioLinks, extra: { specimen?: SpecimenInput; options?: OptionsInput } = {}): Record<string, unknown> {
  const adapter = ADAPTERS[leaf.agent];
  const galleryHref = links.gallery(leaf.agent) ?? '';
  const header: LeafHeaderInput = {
    name: leaf.card.name, id: leaf.card.id, version: leaf.card.version,
    statusLabel: STATUS_LABEL[leaf.card.status], statusTone: STATUS_TONE[leaf.card.status],
    statusDetail: leaf.statusDetail, trail: leaf.trail, galleryHref, galleryLabel: studioCopy("studio.agent-library-title", { value0: String(adapter.label) }),
  };
  const checks: CheckRow[] = leaf.checks.map((check, index) => ({ key: `${index}`, label: check.label, ok: check.ok, detail: check.detail ?? '' }));
  const contract: ContractInput = { copy: contractCopy(), facts: leaf.contract.facts, lists: leaf.contract.lists };
  const history: HistoryInput = { rows: leaf.history.map(row => ({
    version: row.version, date: row.updated, note: row.note || '—',
    marks: [row.active && studioCopy("studio.active"), STATUS_LABEL[row.status]].filter((mark, index, all): mark is string => Boolean(mark) && all.indexOf(mark) === index),
  })) };
  const references: ReferencesInput = { copy: referencesCopy(), uses: leaf.uses.map(ref => toRef(links, ref)), usedBy: leaf.usedBy.map(ref => toRef(links, ref)), lineage: agentLineage(leaf) };
  return {
    header, specimen: extra.specimen ?? agentRecordSpecimen(leaf, links), options: extra.options,
    checks: checks.length ? { rows: checks, copy: checksCopy(checks) } : undefined, contract, history, references,
  };
}
