import { studioCopy } from './studio-copy';
import { LEAF_STATUS_LABEL, LEAF_STATUS_TONE } from './leaf-status';
import type { GalleryCardData, GalleryCardState, GalleryGroupData, GalleryLayerData, GallerySelection } from '../sections/studio-agent-gallery/types';
import type { SpecimenInput } from '../sections/studio-specimen';

/**
 * The shared gallery layout data every agent page renders: Producer's flat L0/L1/L2 sections
 * become tabs (L0), list entries with slot counts (L1) and headings over cards (L2).
 */
/** Whether a specimen has anything to render: a framed viewport, or a record table, row or status. */
export function hasPreviewData(specimen: SpecimenInput): boolean {
  if (specimen.kind === 'viewports') return specimen.specimens.some(row => row.light.length > 0);
  return Boolean(specimen.lead?.length || specimen.tables?.some(table => table.rows.length) || specimen.rows?.length || specimen.status);
}

/** A card without preview data has no body, the same as an empty slot: its state badge reads once. */
function withPreview(card: GalleryCardData): GalleryCardData {
  if (!card.specimen || hasPreviewData(card.specimen)) return card;
  const { specimen: _none, ...rest } = card;
  return rest;
}

export interface FlatSection<C> { id: string; label: string; level: 0 | 1 | 2; cards: readonly C[] }

export function galleryLayers<C>(sections: readonly FlatSection<C>[], card: (card: C) => GalleryCardData): GalleryLayerData[] {
  const layers: { id: string; label: string; groups: { id: string; label: string; count: number; sections: { id: string; label: string; cards: GalleryCardData[] }[] }[] }[] = [];
  const layer = () => layers.at(-1) ?? (layers.push({ id: 'library', label: studioCopy("studio.library"), groups: [] }), layers.at(-1)!);
  for (const section of sections) {
    if (section.level === 0) { layers.push({ id: section.id, label: section.label, groups: [] }); continue; }
    const current = layer();
    if (section.level === 1) current.groups.push({ id: section.id, label: section.label, count: 0, sections: [] });
    const group = current.groups.at(-1) ?? (current.groups.push({ id: section.id, label: section.label, count: 0, sections: [] }), current.groups.at(-1)!);
    // An L1 that holds cards itself (record-kind grouping) shows them under its own heading.
    if (section.cards.length) {
      group.sections.push({ id: section.id, label: section.label, cards: section.cards.map(row => withPreview(card(row))) });
      group.count += section.cards.length;
    }
  }
  return layers.map(row => ({ ...row, groups: row.groups.filter(group => group.count) })).filter(row => row.groups.length);
}

/** The slot label without its L0 prefix: `themes.background` -> "Background". */
export function slotLabel(id: string): string {
  const rest = id.includes('.') ? id.slice(id.indexOf('.') + 1) : id;
  const text = rest.replace(/[.-]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The one state badge a slot card shows. */
export function cardState(input: { failing: boolean; pinned: boolean; options: number }): Pick<GalleryCardData, 'state' | 'statusLabel' | 'statusTone'> {
  const state: GalleryCardState = input.failing ? 'failing' : input.pinned ? 'pinned' : input.options ? 'options' : 'empty';
  if (state === 'failing') return { state, statusLabel: LEAF_STATUS_LABEL.failing, statusTone: LEAF_STATUS_TONE.failing };
  if (state === 'pinned') return { state, statusLabel: studioCopy("studio.pinned"), statusTone: 'secondary' };
  if (state === 'options') return { state, statusLabel: studioCopy("studio.options-count", { count: input.options }), statusTone: 'outline' };
  return { state, statusLabel: studioCopy("studio.not-filled-yet"), statusTone: 'outline' };
}

/** "X of Y slots pinned" over every card the layers hold. */
export function pinnedSummary(layers: readonly GalleryLayerData[]): string {
  const cards = layers.flatMap(layer => layer.groups.flatMap(group => group.sections.flatMap(section => section.cards)));
  return studioCopy("studio.slots-pinned", { pinned: cards.filter(card => card.state === 'pinned').length, total: cards.length });
}

/** A requested selection, or the first tab and its first group when the request names neither. */
export function resolveSelection(layers: readonly GalleryLayerData[], wanted: Partial<GallerySelection>): GallerySelection {
  const layer = layers.find(row => row.id === wanted.layer) ?? layers[0];
  const group = layer?.groups.find(row => row.id === wanted.group) ?? layer?.groups[0];
  return { layer: layer?.id ?? '', group: group?.id ?? '' };
}

/** The tab and group that hold one card, for the explorer. */
export function selectionOf(layers: readonly GalleryLayerData[], key: string): GallerySelection | undefined {
  for (const layer of layers) for (const group of layer.groups) if (group.sections.some(section => section.cards.some(card => card.key === key))) return { layer: layer.id, group: group.id };
  return undefined;
}
