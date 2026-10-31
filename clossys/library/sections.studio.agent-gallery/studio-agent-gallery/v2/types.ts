/** View data for any agent's gallery. Every field is display-ready; the blocks only lay it out. */
export type GalleryTone = 'secondary' | 'outline' | 'destructive';

export interface GalleryCardData {
  key: string;
  name: string;
  version?: number;
  statusLabel: string;
  statusTone: GalleryTone;
  href: string;
  /** A rendered specimen (`/__specimen`) thumbnail; agents without one show `excerpt` lines. */
  specimenSrc?: string;
  excerpt?: readonly string[];
  /** Set when there is nothing to preview: the card shows this shared leaf status (label and tone) instead. */
  specimenStatus?: { label: string; tone: GalleryTone };
  /** Extra outline marks beside the status, such as options pending approval. */
  badges?: readonly string[];
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
