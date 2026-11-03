import type { SpecimenInput } from '../studio-specimen';

/** View data for any agent's gallery. Every field is display-ready; the blocks only lay it out. */
export type GalleryTone = 'secondary' | 'outline' | 'destructive';

/** The one state a slot card shows: its pin, its waiting options, nothing yet, or a failing record. */
export type GalleryCardState = 'pinned' | 'options' | 'empty' | 'failing';

export interface GalleryCardData {
  key: string;
  /** The slot label without its L0 prefix ("Background", not "Themes background"). */
  name: string;
  state: GalleryCardState;
  /** The one state badge: Pinned, N options or the empty-slot label. */
  statusLabel: string;
  statusTone: GalleryTone;
  /** The slot's L3 detail route. */
  href: string;
  /**
   * The full live preview of the shown state, in the shape the leaf page's specimen section takes:
   * a Designer item or a Publisher page framed at desktop width, a Writer or Director record's content.
   */
  specimen?: SpecimenInput;
  /** Set while the preview loads (`loading`) or when it could not load. An empty slot has neither. */
  specimenStatus?: { label: string; tone: GalleryTone; loading?: boolean };
}

/** An L2 group: a heading over its slot cards. */
export interface GallerySectionData { id: string; label: string; cards: readonly GalleryCardData[] }

/** An L1 group: one entry of the left list (with its slot count) and the L2 groups it shows. */
export interface GalleryGroupData { id: string; label: string; count: number; sections: readonly GallerySectionData[] }

/** An L0 layer: one tab. */
export interface GalleryLayerData { id: string; label: string; groups: readonly GalleryGroupData[] }

export interface GalleryHeaderData {
  title: string;
  /** The agent's one-line purpose. */
  description: string;
  /** "X of Y slots pinned". */
  pinned: string;
  /** Shown when the leaves are grouped by record kind because the agent has no IA data. */
  notice?: string;
}

/** The tab (L0) and group (L1) on screen; the page keeps them in the URL. */
export interface GallerySelection { layer: string; group: string }

/** The `gallery` input of `sections.studio.agent-gallery`: one agent's library, display-ready. */
export interface AgentGalleryInput {
  header: GalleryHeaderData;
  layers: readonly GalleryLayerData[];
  selection: GallerySelection;
  onSelect?: (selection: GallerySelection) => void;
}
