/** View data for one Designer leaf. Every field is display-ready; the blocks only lay it out. */
export type DetailTone = 'secondary' | 'outline' | 'destructive';

export interface DetailHeaderData {
  name: string;
  slot: string;
  version?: number;
  statusLabel: string;
  statusTone: DetailTone;
  statusDetail: readonly string[];
  trail: readonly string[];
  galleryHref: string;
}

export interface DetailContractData {
  kind?: string;
  root?: string;
  inputs: readonly { name: string; type: string; required: boolean }[];
  lists: readonly { label: string; items: readonly string[] }[];
}

export interface DetailLineageRow { version: number; mode: string; parent: string; source: string }

export interface DetailVersionRow { version: number; createdAt: string; reason: string; hash: string; flags: readonly string[] }

/** One viewport's specimen URLs; the frame renders the page at `viewport` CSS px and scales it to fit. */
export interface DetailSpecimenData { viewport: 375 | 768 | 1280; light: string; dark: string }

/** One version beside the pin: the pinned version first, then each newer option, framed at 1280 CSS px. */
export interface DetailOptionData { version: number; pinned: boolean; reason: string; src: string }
