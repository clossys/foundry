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
