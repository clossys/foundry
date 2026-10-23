import type { CanvasFilter } from "./canvas-model.js";
import type { CSSProperties, ReactNode } from "react";
import type { CheckCategory } from "./matrix-model.js";
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
  canvas: { label: string; hint: string; search: string; explorerOpen: string; explorerClose: string; inspectorClose: string; minimap: string; filters: Record<CanvasFilter, string>; zoomLabel: string; zoomIn: string; zoomOut: string; fit: string; zoom: (percent: number) => string; openBoard: (name: string) => string; goToBoard: (name: string) => string };
  layers: { label: string; tokens: string; assets: string; components: string; sections: string; frames: string; disabled: string };
  progress: (decided: number, total: number) => string;
  scorecard: { title: string; close: string; decided: string; resolved: string; checks: string; issues: string; noIssues: string; target: string; categories: Record<CheckCategory, string>; counts: (errors: number, notices: number) => string; supported: (codes: readonly string[]) => string };
  matrix: { label: string; leaf: string; libraries: string; showAll: string; expand: (leaf: string) => string; collapse: (leaf: string) => string; differs: string; pending: string };
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
  previewUnavailable: string;
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
  inspector: { representedLeaf: string; trust: string; usedBy: string; none: string; source: string; mode: string; licence: string; pin: string; status: string; evidence: string; members: string; findings: string; via: string; light: string; dark: string; alias: string; builtOn: string; relation: string };
}

export interface StudioPanelInsets {
  blockStart?: CSSProperties["insetBlockStart"]; blockEnd?: CSSProperties["insetBlockEnd"]; inlineStart?: CSSProperties["insetInlineStart"]; inlineEnd?: CSSProperties["insetInlineEnd"];
}
export interface StudioHeaderProps { className?: string }
export interface StudioCanvasProps { header?: "internal" | "external"; panelInsets?: StudioPanelInsets; className?: string }
export interface StudioProviderProps extends Omit<StudioProps, "header" | "panelInsets" | "className"> { children: ReactNode }

export interface StudioProps extends StudioCanvasProps {
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
