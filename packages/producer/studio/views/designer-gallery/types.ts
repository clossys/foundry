/** View data for the Designer gallery. Every field is display-ready; the blocks only lay it out. */
export type GalleryTone = 'secondary' | 'outline' | 'destructive';

export interface GalleryCardData {
  key: string;
  name: string;
  version?: number;
  statusLabel: string;
  statusTone: GalleryTone;
  href: string;
  specimenSrc?: string;
}

export interface GalleryGroupData { id: string; label: string; level: 1 | 2; cards: readonly GalleryCardData[] }

export interface GalleryLayerData { id: string; label: string; groups: readonly GalleryGroupData[] }
