/**
 * Studio agent library client: the Director, Writer and Publisher galleries and leaf
 * details read Producer's record projection over HTTP only (`/api/agents/<agent>/library[/<leaf>]`),
 * and one adapter per agent turns it into the shared gallery and detail template data.
 * REPLACE with the Publisher content-map projection when it lands.
 */
import type { GalleryHeaderData, GalleryLayerData, GalleryNoticeData } from '../views/agent-gallery/types';
import type { DetailCheckRow, DetailContractData, DetailHeaderData, DetailHistoryData, DetailRef, DetailSpecimenData, DetailUsesData } from '../views/agent-detail/types';
import { LEAF_STATUS_LABEL as STATUS_LABEL, LEAF_STATUS_TONE as STATUS_TONE, type LeafStatus } from './leaf-status';

export const LIBRARY_AGENTS = ['director', 'writer', 'publisher'] as const;
export type LibraryAgent = typeof LIBRARY_AGENTS[number];
export const isLibraryAgent = (value: string): value is LibraryAgent => (LIBRARY_AGENTS as readonly string[]).includes(value);

export type AgentLeafStatus = 'active' | 'draft' | 'retired';
export interface AgentRef { label: string; agent?: string; slug?: string }
export interface AgentCard { id: string; slug: string; name: string; version: number; status: AgentLeafStatus; excerpt: string[]; records?: number }
export interface AgentSpecimenTable { id: string; label: string; columns: string[]; rows: { key: string; cells: { text: string; ref?: AgentRef; status?: string }[] }[] }
export interface AgentSection { id: string; label: string; level: 0 | 1 | 2; cards: AgentCard[] }
export interface AgentGalleryRecords { state: 'ready' | 'missing'; agent: LibraryAgent; grouping?: 'ia' | 'kind'; sections: AgentSection[]; count: number }
export interface AgentLeafRecords {
  agent: LibraryAgent; card: AgentCard; trail: string[]; statusDetail: string[];
  specimen: { summary: string; rows: { label: string; text: string; ref?: AgentRef }[]; kind?: string; tables?: AgentSpecimenTable[] };
  checks: { label: string; ok: boolean; detail?: string }[];
  contract: { facts: { label: string; value: string }[]; lists: { label: string; items: string[] }[] };
  history: { version: number; status: AgentLeafStatus; updated: string; note: string; active: boolean }[];
  uses: AgentRef[]; usedBy: AgentRef[];
}

/** Per-agent copy: the only thing that differs between the agents' galleries and details. */
interface AgentAdapter {
  label: string;
  unit: readonly [string, string];
  description: string;
  specimenTitle: string;
}
const ADAPTERS: Record<LibraryAgent, AgentAdapter> = {
  director: { label: 'Director', unit: ['brief', 'briefs'], description: 'Strategy records, grouped by the strategy catalog. Open one for its direction, checks and lineage.', specimenTitle: 'Direction' },
  writer: { label: 'Writer', unit: ['copy cell', 'copy cells'], description: 'Copy cells and their keys. Open one for its strings, bindings and history.', specimenTitle: 'Strings' },
  publisher: { label: 'Publisher', unit: ['page', 'pages'], description: 'Page records. Open one for the sections it assembles and the copy it binds.', specimenTitle: 'Sections' },
};


export const agentGalleryHref = (agent: string) => `/${agent}`;
export const agentLeafHref = (agent: string, slug: string) => `/${agent}/${encodeURIComponent(slug)}`;
const KIND_TITLE: Record<string, string> = { voice: 'Voice', claims: 'Claims', naming: 'Names' };
const isLeafStatus = (value: string | undefined): value is LeafStatus => value !== undefined && value in STATUS_LABEL;
/** A cell with no records has nothing to preview: the shared `missing` status says so. */
const emptyStatus = (card: AgentCard): LeafStatus | undefined => card.records === 0 ? 'missing' : undefined;
const refHref = (ref: AgentRef) => ref.agent && ref.slug ? agentLeafHref(ref.agent, ref.slug) : undefined;
const toRef = (ref: AgentRef): DetailRef => { const href = refHref(ref); return { label: ref.label, ...(href ? { href } : {}) }; };

async function request(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Producer could not load this agent library (${response.status}).`);
  return response.json();
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

export async function loadAgentGallery(agent: LibraryAgent, signal: AbortSignal): Promise<AgentGalleryRecords> {
  const value = await request(`/api/agents/${agent}/library`, signal);
  if (!object(value) || !Array.isArray(value.sections) || typeof value.count !== 'number') throw new Error('The agent library response is invalid.');
  return value as unknown as AgentGalleryRecords;
}

export async function loadAgentLeaf(agent: LibraryAgent, slug: string, signal: AbortSignal): Promise<AgentLeafRecords | undefined> {
  const value = await request(`/api/agents/${agent}/library/${encodeURIComponent(slug)}`, signal);
  if (value === undefined) return undefined;
  if (!object(value) || value.state !== 'ready' || !object(value.leaf)) throw new Error('The agent leaf response is invalid.');
  return value.leaf as unknown as AgentLeafRecords;
}

export const agentUnit = (agent: LibraryAgent) => ADAPTERS[agent].unit;

export function agentNotice(agent: LibraryAgent, state: 'missing' | 'error', message?: string): GalleryNoticeData {
  const { label } = ADAPTERS[agent];
  return state === 'missing'
    ? { title: `No ${label} records yet`, description: `Producer found no ${label} cells in this workspace.` }
    : { title: `The ${label} library could not load`, description: message ?? 'Producer returned an error.' };
}

export function agentGalleryHeader(records: AgentGalleryRecords): GalleryHeaderData {
  const adapter = ADAPTERS[records.agent];
  return {
    title: `${adapter.label} library`,
    description: `${records.count} ${records.count === 1 ? adapter.unit[0] : adapter.unit[1]} from the record store. ${adapter.description}`,
    ...(records.grouping === 'kind' ? { notice: 'Grouped by record kind: this agent has no IA data.' } : {}),
  };
}

/** Records -> display data: L0 sections open a layer; L1/L2 sections become its groups. */
export function agentGalleryLayers(records: AgentGalleryRecords): GalleryLayerData[] {
  const layers: { id: string; label: string; groups: GalleryLayerData['groups'][number][] }[] = [];
  for (const section of records.sections) {
    if (section.level === 0) { layers.push({ id: section.id, label: section.label, groups: [] }); continue; }
    if (!layers.length) layers.push({ id: `${section.id}-layer`, label: section.label, groups: [] });
    layers.at(-1)!.groups.push({
      id: section.id, label: section.label, level: section.level,
      cards: section.cards.map(card => ({
        key: card.id, name: card.name, version: card.version,
        statusLabel: STATUS_LABEL[card.status], statusTone: STATUS_TONE[card.status],
        href: agentLeafHref(records.agent, card.slug), excerpt: card.excerpt,
        ...(emptyStatus(card) ? { specimenStatus: emptyStatus(card)! } : {}),
      })),
    });
  }
  return layers.filter(layer => layer.groups.length);
}

export interface AgentDetailData {
  header: DetailHeaderData; specimen: DetailSpecimenData; checks: DetailCheckRow[]; contract: DetailContractData; history: DetailHistoryData; uses: DetailUsesData;
}

export function agentDetailData(leaf: AgentLeafRecords): AgentDetailData {
  const adapter = ADAPTERS[leaf.agent];
  return {
    header: {
      name: leaf.card.name, id: leaf.card.id, version: leaf.card.version,
      statusLabel: STATUS_LABEL[leaf.card.status], statusTone: STATUS_TONE[leaf.card.status],
      statusDetail: leaf.statusDetail, trail: leaf.trail, galleryHref: agentGalleryHref(leaf.agent), galleryLabel: `${adapter.label} library`,
    },
    specimen: {
      title: KIND_TITLE[leaf.specimen.kind ?? ''] ?? adapter.specimenTitle, description: leaf.specimen.summary,
      rows: leaf.specimen.rows.map((row, index) => {
        const href = row.ref ? refHref(row.ref) : undefined;
        return { key: `${index}`, label: row.label, text: row.text, ...(href ? { href } : {}) };
      }),
      ...(leaf.specimen.tables?.length ? { tables: leaf.specimen.tables.map(table => ({
        id: table.id, label: table.label, columns: table.columns,
        rows: table.rows.map(row => ({ key: row.key, cells: row.cells.map(cell => {
          const href = cell.ref ? refHref(cell.ref) : undefined;
          return { text: cell.text, ...(href ? { href } : {}), ...(isLeafStatus(cell.status) ? { statusLabel: STATUS_LABEL[cell.status], statusTone: STATUS_TONE[cell.status] } : {}) };
        }) })),
      })) } : {}),
      ...(emptyStatus(leaf.card) ? { status: emptyStatus(leaf.card)! } : {}),
    },
    checks: leaf.checks.map((check, index) => ({ key: `${index}`, label: check.label, ok: check.ok, detail: check.detail ?? '' })),
    contract: { facts: leaf.contract.facts, lists: leaf.contract.lists },
    history: { rows: leaf.history.map(row => ({
      version: row.version, date: row.updated, note: row.note || '—',
      marks: [row.active && 'Active', STATUS_LABEL[row.status]].filter((mark, index, all): mark is string => Boolean(mark) && all.indexOf(mark) === index),
    })) },
    uses: { uses: leaf.uses.map(toRef), usedBy: leaf.usedBy.map(toRef) },
  };
}
