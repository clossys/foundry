import type { SpecimenInput } from '../studio-specimen';

/** View data for any agent's gallery. Every field is display-ready; the blocks only lay it out. */
export type GalleryTone = 'secondary' | 'outline' | 'destructive';

export interface GalleryCardData {
  key: string;
  name: string;
  version?: number;
  statusLabel: string;
  statusTone: GalleryTone;
  href: string;
  /**
   * The full live preview of the active state, in the shape the leaf page's specimen section takes:
   * a Designer item or a Publisher page framed at desktop width, a Writer or Director record's content.
   */
  specimen?: SpecimenInput;
  /** Set while the preview loads (`loading`) or when there is nothing to preview (the shared leaf status). */
  specimenStatus?: { label: string; tone: GalleryTone; loading?: boolean };
}

export interface GalleryGroupData { id: string; label: string; level: 1 | 2; cards: readonly GalleryCardData[] }

export interface GalleryLayerData { id: string; label: string; groups: readonly GalleryGroupData[] }

export interface GalleryHeaderData {
  title: string;
  description: string;
  /** Shown when the leaves are grouped by record kind because the agent has no IA data. */
  notice?: string;
}

/** The `gallery` input of `sections.studio.agent-gallery`: one agent's library, display-ready. */
export interface AgentGalleryInput { header: GalleryHeaderData; unit: readonly [string, string]; layers: readonly GalleryLayerData[] }
