import { producerUrl } from './producer-url';
import { optionCopy, optionsCopy } from './options-copy';
import { referencesCopy } from './references-copy';
import { contractCopy } from './contract-copy';
import { studioCopy } from './studio-copy';
/**
 * Studio Designer library client: the gallery and leaf read Producer's record-store projection
 * over HTTP only (`/api/designer/library[/<leaf>]`), and the adapter below turns it into the
 * inputs of the Studio sections the page records place. Links resolve through the Studio map.
 */
import type { AgentGalleryInput, GalleryLayerData } from '../sections/studio-agent-gallery/types';
import type { ContractInput } from '../sections/studio-contract';
import type { HistoryInput } from '../sections/studio-history';
import type { LeafHeaderInput } from '../sections/studio-leaf-header';
import type { OptionsInput } from '../sections/studio-options';
import type { ReferencesInput } from '../sections/studio-references';
import type { SpecimenInput } from '../sections/studio-specimen';
import type { PageNoticeData } from '../frames/studio-shell/PageNotice';
import type { StudioLinks } from './agent-library';
import { LEAF_STATUS_LABEL, LEAF_STATUS_TONE, LEAF_UNIT, specimenDescription } from './leaf-status';
import { cardState, galleryLayers, pinnedSummary, slotLabel } from './gallery-layout';

/** `pending`: nothing pinned, options recorded. `missing`: no version exists at all. */
export type DesignerStatus = 'pinned' | 'pending' | 'missing' | 'failing' | 'stale' | 'unreleased';

export interface DesignerCard {
  slot: string; slug: string; name: string; layer: string; status: DesignerStatus;
  element?: string; version?: number; pinned: boolean; specimen?: string;
  /** Options pending approval: versions newer than the pin, or every version when nothing is pinned. */
  options: number[]; candidate?: string; emptyState?: 'No candidate' | 'No pin';
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

async function request(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(producerUrl(path), { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(studioCopy("studio.producer-could-not-load-the-designer-library", { value0: String(response.status) }));
  return response.json();
}

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

export async function loadDesignerGallery(signal: AbortSignal): Promise<DesignerGallery> {
  const value = await request('/api/designer/library', signal);
  if (!object(value) || !Array.isArray(value.sections) || typeof value.count !== 'number') throw new Error(studioCopy("studio.the-designer-library-response-is-invalid"));
  return value as unknown as DesignerGallery;
}

export async function loadDesignerLeaf(slug: string, signal: AbortSignal): Promise<DesignerLeaf | undefined> {
  const value = await request(`/api/designer/library/${encodeURIComponent(slug)}`, signal);
  if (value === undefined) return undefined;
  if (!object(value) || value.state !== 'ready' || !object(value.leaf)) throw new Error(studioCopy("studio.the-designer-leaf-response-is-invalid"));
  return value.leaf as unknown as DesignerLeaf;
}

/* Designer adapter: records -> the Studio section inputs. */

/** A gallery card frames every item at desktop width, the width the site renders it at. */
const GALLERY_WIDTH = 1280;
const SPECIMEN_VIEWPORTS = [375, 768, 1280] as const;
export const DESIGNER_UNIT = LEAF_UNIT;

export function designerNotice(state: 'missing' | 'error', message?: string): PageNoticeData {
  return state === 'missing'
    ? { title: studioCopy("studio.no-designer-library-yet"), description: studioCopy("studio.producer-found-no-record-store-for-this") }
    : { title: studioCopy("studio.the-designer-library-could-not-load"), description: message ?? studioCopy("studio.producer-returned-an-error") };
}

/** Records -> display data: L0 sections are tabs, L1 sections list entries, L2 sections headings over cards. */
export function designerGalleryLayers(records: DesignerGallery, theme: 'light' | 'dark', links: StudioLinks): GalleryLayerData[] {
  return galleryLayers(records.sections, card => {
    // The full live preview: the shown state framed view-only at desktop width in the page's theme.
    const src = card.status === 'failing' ? undefined : specimenHref(card, theme, GALLERY_WIDTH);
    const specimen: SpecimenInput | undefined = src ? {
      kind: 'viewports', name: card.name, title: studioCopy("studio.specimen"), description: specimenDescription(card.status),
      specimens: [{ viewport: GALLERY_WIDTH, light: src, interactive: false }], empty: studioCopy("studio.no-specimen-recorded-for-this-leaf-yet"),
    } : undefined;
    return {
      key: card.slot, name: slotLabel(card.slot), href: links.leaf('designer', card.slug) ?? '',
      ...cardState({ failing: card.status === 'failing', pinned: card.pinned, options: card.status === 'pending' ? card.options.length : 0 }),
      ...(specimen ? { specimen } : {}),
    };
  });
}

/** The `gallery` input for the Designer library (the page adds the selection), or a notice when it has nothing to show. */
export function designerGalleryInput(records: DesignerGallery, theme: 'light' | 'dark', links: StudioLinks, purpose: string): Omit<AgentGalleryInput, 'selection'> | PageNoticeData {
  const layers = designerGalleryLayers(records, theme, links);
  if (records.state === 'missing' || !layers.length) return designerNotice('missing');
  return { header: { title: studioCopy("studio.designer"), description: purpose, pinned: pinnedSummary(layers) }, layers };
}

/** The options description, shared by every agent: how many versions wait beside the pin, if any. */
export function optionsDescription(pinned: boolean, options: number, noun: 'pinned' | 'active' = 'pinned'): string {
  return pinned
    ? studioCopy("studio.newer-options-description", { count: options, noun })
    : studioCopy("studio.unpinned-options-description", { count: options, noun });
}

const versionFlags = (row: DesignerVersionRow) => [row.pinned && studioCopy("studio.pinned"), row.released && studioCopy("studio.released"), row.verified && studioCopy("studio.verified")].filter((flag): flag is string => Boolean(flag));

/** Every section input a Designer leaf page places, display-ready. */
export function designerLeafInputs(leaf: DesignerLeaf, theme: 'light' | 'dark', links: StudioLinks): Record<string, unknown> {
  const { card } = leaf;
  const lineage = new Map(leaf.lineage.map(row => [row.version, row]));
  // Pending: every recorded version is an option; pinned: the pin first, then each newer option.
  const optionVersions = card.pinned && card.version !== undefined && card.options.length ? [card.version, ...card.options] : card.pinned ? [] : card.options;
  const header: LeafHeaderInput = {
    name: card.name, id: card.slot, ...(card.version !== undefined ? { version: card.version } : {}),
    statusLabel: LEAF_STATUS_LABEL[card.status], statusTone: LEAF_STATUS_TONE[card.status],
    statusDetail: leaf.statusDetail, trail: leaf.trail, galleryHref: links.gallery('designer') ?? '', galleryLabel: studioCopy("studio.designer-library"),
  };
  const contract: ContractInput = {
    copy: contractCopy(),
    facts: [
      ...(leaf.contract.kind ? [{ label: studioCopy("studio.kind"), value: leaf.contract.kind }] : []),
      ...(leaf.contract.root ? [{ label: studioCopy("studio.root"), value: leaf.contract.root }] : []),
    ],
    inputs: leaf.contract.inputs,
    lists: [
      { label: studioCopy("studio.composes"), items: leaf.contract.composes },
      { label: studioCopy("studio.copy-keys"), items: leaf.contract.copyKeys },
      { label: studioCopy("studio.theme-variables"), items: leaf.contract.themeVars },
      { label: studioCopy("studio.depends-on"), items: leaf.contract.dependencies },
    ],
  };
  const history: HistoryInput = {
    rows: leaf.versions.map(row => {
      const step = lineage.get(row.version);
      const mode = step ? [step.mode, step.parent !== undefined && studioCopy("studio.from-v", { value0: String(step.parent) })].filter(Boolean).join(' ') : row.lineage;
      return {
        version: row.version, date: row.createdAt, note: row.reason || '—', marks: versionFlags(row),
        lineage: { mode, ...(step?.source ? { source: step.source } : {}) }, ...(row.hash ? { hash: row.hash } : {}),
      };
    }),
  };
  const specimen: SpecimenInput = {
    kind: 'viewports', name: card.name, title: studioCopy("studio.specimen"), description: specimenDescription(card.status),
    specimens: card.specimen ? SPECIMEN_VIEWPORTS.map(viewport => ({ viewport, light: specimenHref(card, 'light', viewport)!, dark: specimenHref(card, 'dark', viewport)! })) : [],
    empty: studioCopy("studio.no-specimen-recorded-for-this-leaf-yet"),
  };
  const options: OptionsInput | undefined = card.specimen && optionVersions.length ? {
    copy: optionsCopy(),
    name: card.name,
    description: optionsDescription(card.pinned, optionVersions.length - (card.pinned ? 1 : 0)),
    rows: optionVersions.map(version => {
      const pinned = card.pinned && version === card.version;
      return {
        version, pinned, copy: optionCopy(card.name, { version, pinned }), label: pinned ? studioCopy("studio.pinned-v", { value0: String(version) }) : studioCopy("studio.option-v", { value0: String(version) }),
        reason: leaf.versions.find(row => row.version === version)?.reason ?? '',
        preview: { kind: 'frame' as const, viewport: 1280 as const, src: specimenHref({ specimen: card.specimen, version }, theme, 1280)! },
      };
    }),
  } : undefined;
  // Uses: what the leaf composes; used by is not recorded for Designer leaves yet.
  const references: ReferencesInput = {
    copy: referencesCopy(),
    uses: leaf.contract.composes.map(label => ({ label })), usedBy: [],
    lineage: leaf.lineage.map(row => ({
      key: `v${row.version}`, version: `v${row.version}`,
      mode: [row.mode, row.parent !== undefined && studioCopy("studio.from-v", { value0: String(row.parent) })].filter(Boolean).join(' '),
      source: row.source ?? '—',
    })),
  };
  return { header, specimen, options, contract, history, references };
}
