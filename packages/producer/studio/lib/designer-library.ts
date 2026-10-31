/**
 * PROOF-2 Designer library client: the gallery and leaf detail read Producer's
 * record-store projection over HTTP only (`/api/designer/library[/<leaf>]`).
 * REPLACE with the Publisher content-map projection when it lands.
 */
import type { GalleryHeaderData, GalleryLayerData, GalleryNoticeData } from '../views/agent-gallery/types';
import type { DetailContractData, DetailHeaderData, DetailHistoryData } from '../views/agent-detail/types';
import type { DetailOptionData, ViewportSpecimenData } from '../views/designer-slots/types';
import { LEAF_STATUS_LABEL, LEAF_STATUS_TONE, pendingOptionsBadge, specimenDescription } from './leaf-status';

/** `pending`: nothing pinned, options recorded. `missing`: no version exists at all. */
export type DesignerStatus = 'pinned' | 'pending' | 'missing' | 'failing' | 'stale' | 'unreleased';

export interface DesignerCard {
  slot: string; slug: string; name: string; layer: string; status: DesignerStatus;
  element?: string; version?: number; pinned: boolean; specimen?: string;
  /** Options pending approval: versions newer than the pin, or every version when nothing is pinned. */
  options: number[];
}
export interface DesignerSection { id: string; label: string; level: 0 | 1 | 2; cards: DesignerCard[] }
export interface DesignerGallery { state: 'ready' | 'missing'; sections: DesignerSection[]; count: number }
export interface DesignerVersionRow { version: number; hash: string; createdAt: string; reason: string; lineage: string; pinned: boolean; released: boolean; verified: boolean }
export interface DesignerLeaf {
  card: DesignerCard;
  trail: string[];
  statusDetail: string[];
  record?: { kind: string; package: string; license: string; creator: string; reason: string; createdAt: string; hash: string };
  contract: { kind?: string; root?: string; inputs: { name: string; type: string; required: boolean }[]; composes: string[]; copyKeys: string[]; themeVars: string[]; dependencies: string[] };
  lineage: { version: number; mode: string; parent?: number; source?: string }[];
  versions: DesignerVersionRow[];
}

/** The one specimen URL: Producer's `/__specimen`, which frames the installed item at `width` CSS px and scales it to fit. */
export function specimenHref(card: Pick<DesignerCard, 'specimen' | 'version'>, theme: 'light' | 'dark', width: number): string | undefined {
  if (!card.specimen) return undefined;
  const params = new URLSearchParams({ element: card.specimen, theme, width: String(width) });
  if (card.version) params.set('v', String(card.version));
  return `/__specimen?${params}`;
}

export const designerLeafHref = (slug: string) => `/designer/${encodeURIComponent(slug)}`;

async function request(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Producer could not load the Designer library (${response.status}).`);
  return response.json();
}

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

export async function loadDesignerGallery(signal: AbortSignal): Promise<DesignerGallery> {
  const value = await request('/api/designer/library', signal);
  if (!object(value) || !Array.isArray(value.sections) || typeof value.count !== 'number') throw new Error('The Designer library response is invalid.');
  return value as unknown as DesignerGallery;
}

export async function loadDesignerLeaf(slug: string, signal: AbortSignal): Promise<DesignerLeaf | undefined> {
  const value = await request(`/api/designer/library/${encodeURIComponent(slug)}`, signal);
  if (value === undefined) return undefined;
  if (!object(value) || value.state !== 'ready' || !object(value.leaf)) throw new Error('The Designer leaf response is invalid.');
  return value.leaf as unknown as DesignerLeaf;
}

/* Designer adapter: records -> the shared agent gallery and detail template data. */

/** A component is a small part of a page: frame it at a phone viewport so it reads at thumbnail scale; pages and themes frame at desktop. */
const THUMBNAIL_WIDTH: Record<string, number> = { components: 375 };
const SPECIMEN_VIEWPORTS = [375, 768, 1280] as const;
export const DESIGNER_UNIT = ['leaf', 'leaves'] as const;

export function designerNotice(state: 'missing' | 'error', message?: string): GalleryNoticeData {
  return state === 'missing'
    ? { title: 'No Designer library yet', description: 'Producer found no record store for this workspace.' }
    : { title: 'The Designer library could not load', description: message ?? 'Producer returned an error.' };
}

export function designerGalleryHeader(records: DesignerGallery): GalleryHeaderData {
  return {
    title: 'Designer library',
    description: `${records.count === 1 ? '1 leaf' : `${records.count} leaves`} from the record store. Open a leaf for its contract, lineage and versions.`,
  };
}

/** Records -> display data: L0 sections open a layer; L1/L2 sections become its groups. */
export function designerGalleryLayers(records: DesignerGallery, theme: 'light' | 'dark'): GalleryLayerData[] {
  const layers: { id: string; label: string; groups: GalleryLayerData['groups'][number][] }[] = [];
  for (const section of records.sections) {
    if (section.level === 0) { layers.push({ id: section.id, label: section.label, groups: [] }); continue; }
    if (!layers.length) layers.push({ id: `${section.id}-layer`, label: section.label, groups: [] });
    layers.at(-1)!.groups.push({
      id: section.id, label: section.label, level: section.level,
      cards: section.cards.map(card => {
        const src = specimenHref(card, theme, THUMBNAIL_WIDTH[card.layer] ?? 1280);
        // A pending card's status already says its versions wait; the badge counts options beside a pin.
        const badges = card.pinned && card.options.length ? [pendingOptionsBadge(card.options.length)] : [];
        return {
          key: card.slot, name: card.name, ...(card.version !== undefined ? { version: card.version } : {}),
          statusLabel: LEAF_STATUS_LABEL[card.status], statusTone: LEAF_STATUS_TONE[card.status],
          href: designerLeafHref(card.slug), ...(src ? { specimenSrc: src } : {}), ...(badges.length ? { badges } : {}),
        };
      }),
    });
  }
  return layers.filter(layer => layer.groups.length);
}

const versionFlags = (row: DesignerVersionRow) => [row.pinned && 'Pinned', row.released && 'Released', row.verified && 'Verified'].filter((flag): flag is string => Boolean(flag));

export interface DesignerDetailData {
  header: DetailHeaderData; contract: DetailContractData; history: DetailHistoryData;
  /** The specimen block's description, from the shared leaf status. */
  specimenDescription: string;
  specimens: ViewportSpecimenData[]; options: DetailOptionData[];
}

export function designerDetailData(leaf: DesignerLeaf, theme: 'light' | 'dark'): DesignerDetailData {
  const { card } = leaf;
  const lineage = new Map(leaf.lineage.map(row => [row.version, row]));
  // Pending: every recorded version is an option; pinned: the pin first, then each newer option.
  const optionVersions = card.pinned && card.version !== undefined && card.options.length ? [card.version, ...card.options] : card.pinned ? [] : card.options;
  return {
    header: {
      name: card.name, id: card.slot, ...(card.version !== undefined ? { version: card.version } : {}),
      statusLabel: LEAF_STATUS_LABEL[card.status], statusTone: LEAF_STATUS_TONE[card.status],
      statusDetail: leaf.statusDetail, trail: leaf.trail, galleryHref: '/designer', galleryLabel: 'Designer library',
    },
    contract: {
      facts: [
        ...(leaf.contract.kind ? [{ label: 'Kind', value: leaf.contract.kind }] : []),
        ...(leaf.contract.root ? [{ label: 'Root', value: leaf.contract.root }] : []),
      ],
      inputs: leaf.contract.inputs,
      lists: [
        { label: 'Composes', items: leaf.contract.composes },
        { label: 'Copy keys', items: leaf.contract.copyKeys },
        { label: 'Theme variables', items: leaf.contract.themeVars },
        { label: 'Depends on', items: leaf.contract.dependencies },
      ],
    },
    history: {
      rows: leaf.versions.map(row => {
        const step = lineage.get(row.version);
        const mode = step ? [step.mode, step.parent !== undefined && `from v${step.parent}`].filter(Boolean).join(' ') : row.lineage;
        return {
          version: row.version, date: row.createdAt, note: row.reason || '—', marks: versionFlags(row),
          lineage: { mode, ...(step?.source ? { source: step.source } : {}) }, ...(row.hash ? { hash: row.hash } : {}),
        };
      }),
    },
    specimenDescription: specimenDescription(card.status),
    specimens: card.specimen ? SPECIMEN_VIEWPORTS.map(viewport => ({ viewport, light: specimenHref(card, 'light', viewport)!, dark: specimenHref(card, 'dark', viewport)! })) : [],
    options: card.specimen ? optionVersions.map(version => ({
      version, pinned: card.pinned && version === card.version,
      reason: leaf.versions.find(row => row.version === version)?.reason ?? '',
      src: specimenHref({ specimen: card.specimen, version }, theme, 1280)!,
    })) : [],
  };
}
