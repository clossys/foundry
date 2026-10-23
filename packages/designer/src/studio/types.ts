import type { CatalogData, ChangeSet, Finding, LibraryData, Selection } from "../catalog-core/index.js";

/** How the Studio reads and writes a consumer's library. The host supplies it; the Studio never touches files or the network. */
export interface StudioAdapter {
  /** Optional catalog carried by a read-only preview adapter. An explicit Studio catalog takes precedence. */
  catalog?: CatalogData;
  load(): Promise<{ library: LibraryData; selection: Selection }>;
  save(changes: ChangeSet): Promise<{ ok: true; selection: Selection } | { ok: false; reason: "unavailable" | "conflict" | "invalid" | "failed"; findings?: readonly Finding[] }>;
  /** False hides Save; the preview stays live. */
  canSave: boolean;
}

/** All chrome copy. The Studio has no English of its own. */
export interface StudioLabels {
  treeLabel: string;
  stageLabel: string;
  inspectorLabel: string;
  /** Visible label of the group of Use radios. */
  useGroup: string;
  /** Accessible name of each Use radio. */
  useSource: (source: string, target: string) => string;
  /** Available members from the contract and loaded fills, including members the demo engine cannot yet preview. */
  memberCount: (count: number) => string;
  scope: { explanation: string; label: string; member: string; slot: string; node: string; memberPicker: string; nodePicker: string };
  /** One-line status of a card. */
  checkSummary: (errors: number, notices: number) => string;
  referenceOnly: string;
  inUseByDefault: string;
  noFill: string;
  pending: (count: number) => string;
  save: string;
  discard: string;
  resetToDefault: string;
  saveFailed: { unavailable: string; conflict: string; invalid: string; failed: string };
  loading: string;
  loadFailed: string;
  sampleText: string;
  fontNotLoaded: string;
  inspector: { source: string; mode: string; licence: string; pin: string; status: string; evidence: string; members: string; findings: string; via: string; light: string; dark: string; alias: string; builtOn: string; relation: string };
}

export interface StudioProps {
  /** Defaults to the adapter catalog, then the engine's throwaway demo catalog. Its `placements` build the slot tree. */
  catalog?: CatalogData;
  /** Loaded once, when the Studio mounts. Keep it stable. */
  adapter: StudioAdapter;
  labels: StudioLabels;
  /** @default "tokens.accent-color" */
  initialSlotId?: string;
  /** Re-themes the whole document from the working selection while mounted. @default true */
  livePreview?: boolean;
  className?: string;
}
