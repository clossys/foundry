/** View data for any agent's leaf. Every field is display-ready; the blocks only lay it out. */
export type DetailTone = 'secondary' | 'outline' | 'destructive';

export interface DetailHeaderData {
  name: string;
  id: string;
  version?: number;
  statusLabel: string;
  statusTone: DetailTone;
  statusDetail: readonly string[];
  trail: readonly string[];
  galleryHref: string;
  galleryLabel: string;
}

export interface DetailRef { label: string; href?: string }

/** A rendered specimen (`src`) or the record's own text as labelled rows. */
export interface DetailSpecimenData {
  title: string;
  description: string;
  src?: string;
  rows?: readonly { key: string; label: string; text: string; href?: string }[];
}

export interface DetailCheckRow { key: string; label: string; ok: boolean; detail: string }

export interface DetailContractData {
  facts: readonly { label: string; value: string }[];
  inputs?: readonly { name: string; type: string; required: boolean }[];
  lists: readonly { label: string; items: readonly string[] }[];
}

export interface DetailHistoryRow { version: number; date: string; note: string; marks: readonly string[] }

export interface DetailUsesData { uses: readonly DetailRef[]; usedBy: readonly DetailRef[] }
