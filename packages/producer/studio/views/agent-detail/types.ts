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
  /** A structured specimen kind (Writer voice, claims, names): titled tables of the record content. */
  tables?: readonly DetailSpecimenTable[];
  /** Set when there is nothing to preview; the block shows this shared leaf status and its description. */
  status?: import('../../lib/leaf-status').LeafStatus;
}

export interface DetailSpecimenTable {
  id: string;
  label: string;
  columns: readonly string[];
  rows: readonly { key: string; cells: readonly { text: string; href?: string; statusLabel?: string; statusTone?: DetailTone }[] }[];
}

export interface DetailCheckRow { key: string; label: string; ok: boolean; detail: string }

export interface DetailContractData {
  facts: readonly { label: string; value: string }[];
  inputs?: readonly { name: string; type: string; required: boolean }[];
  lists: readonly { label: string; items: readonly string[] }[];
}

/** How a version came to be: its mode (`verbatim`, `customized`, ...) and, when it has one, its source. */
export interface DetailLineage { mode: string; source?: string }

/**
 * One recorded version. `lineage` and `hash` are optional columns: the table shows each only
 * when some row carries it. `hash` is the full value (`sha256:...`); the table shortens it.
 */
export interface DetailHistoryRow { version: number; date: string; note: string; marks: readonly string[]; lineage?: DetailLineage; hash?: string }

/** The history table: rows newest first. */
export interface DetailHistoryData { rows: readonly DetailHistoryRow[] }

export interface DetailUsesData { uses: readonly DetailRef[]; usedBy: readonly DetailRef[] }

/**
 * Agent-owned blocks the template places without knowing them: `specimen` replaces the default
 * specimen block, `afterSpecimen` sits directly beneath it.
 */
export interface DetailSlots { specimen?: import('react').ReactNode; afterSpecimen?: import('react').ReactNode }
