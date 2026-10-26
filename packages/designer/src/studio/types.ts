import type { CanvasFilter } from "./canvas-model.js";
import type { CSSProperties, ReactNode, Ref } from "react";
import type { CheckCategory } from "./matrix-model.js";
import type { CatalogData, ChangeSet, Finding, LibraryData, Selection } from "../catalog-core/index.js";

export type StudioWriteResult<F = Finding, L = LibraryData> = { ok: true; library: L } | { ok: false; reason: "unavailable" | "conflict" | "invalid" | "failed"; findings?: readonly F[] };

/** How the Studio reads and writes a consumer's library. The host supplies it; the Studio never touches files or the network. */
export interface StudioAdapter {
  /** Optional catalog carried by a read-only preview adapter. An explicit Studio catalog takes precedence. */
  catalog?: CatalogData;
  /** Called on mount and again after every successful save. selection is a compatibility field; fills are authoritative. */
  load(): Promise<{ library: LibraryData; selection?: Selection }>;
  /** Persist these library operations atomically against baseHash, then regenerate selection v2. Studio reloads after ok. */
  save(changes: ChangeSet): Promise<StudioWriteResult & { selection?: Selection }>;
}

/** All chrome copy. The Studio has no English of its own. */
export interface StudioLabels {
  board: { changeSelection: string; done: string; notChosen: string; choose: string; askAgent: string; custom: string; create: string; refresh: string; promptTitle: string; promptInstruction: string; returnStep: string; copy: string; copied: string; copyFailed: string; close: string; checkCandidates: string; checking: string; candidatesUnavailable: string; candidatesFailed: string; pendingSelection: string; noNewCandidates: string };
  canvas: { noCandidatesInBoard: string; label: string; hint: string; search: string; explorerOpen: string; explorerClose: string; inspectorClose: string; minimap: string; filters: Record<CanvasFilter, string>; zoomLabel: string; zoomIn: string; zoomOut: string; fit: string; zoom: (percent: number) => string; openBoard: (name: string) => string; goToBoard: (name: string) => string };
  layers: { label: string; tokens: string; assets: string; components: string; sections: string; frames: string; disabled: string };
  scorecard: { title: string; close: string; resolved: string; checks: string; issues: string; noIssues: string; target: string; categories: Record<CheckCategory, string>; counts: (errors: number, notices: number) => string; supported: (codes: readonly string[]) => string };
  matrix: { label: string; leaf: string; libraries: string; showAll: string; expand: (leaf: string) => string; collapse: (leaf: string) => string; differs: string; pending: string };
  treeLabel: string;
  stageLabel: string;
  inspectorLabel: string;
  /** Visible label of the group of Use radios. */
  useGroup: string;
  /** Accessible name of each Use radio. */
  useSource: (source: string, target: string) => string;
  /** Available members from the contract and loaded fills, including members without a visual preview. */
  memberCount: (count: number) => string;
  scope: { explanation: string; label: string; member: string; slot: string; node: string; memberPicker: string; nodePicker: string };
  /** One-line status of a card. */
  checkSummary: (errors: number, notices: number) => string;
  previewUnavailable: string;
  visualPreviewUnsupported: string;
  referenceOnly: string;
  inUseByDefault: string;
  noFill: string;
  autosave: { saving: string; saved: string; notSaved: string; retry: string; undo: string; redo: string; changedElsewhere: string; keepMine: string; takeTheirs: string };
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
export interface StudioHeaderProps {
  className?: string;
  layerHref?: (layer: import("../catalog-core/index.js").LayerId) => string;
  /** Called after the session's edits have flushed and the layer selection changes. */
  onLayerNavigate?: (layer: import("../catalog-core/index.js").LayerId, href: string) => void | Promise<void>;
}
/** A checked summary is pending display data; it grants no selection or persistence authority. */
export interface StudioPendingCandidate { id: string; slot: string; label: string; source: string; variants: readonly string[] }
export type StudioCandidateCheckResult = { status: "checked"; candidates: readonly StudioPendingCandidate[] } | { status: "unavailable" | "failed" };
export interface StudioCandidateWorkflow {
  /** Constraints supplied by the host; absent guidelines are omitted rather than invented. */
  guidelines?: Readonly<Record<string, readonly string[]>>;
  returnStep: string;
  actions?: Omit<import("./StudioActions.js").StudioActionsProps, "promptContext" | "taskPrompt">;
  checkCandidates?(slot: string): Promise<StudioCandidateCheckResult>;
}
export interface StudioCanvasProps { header?: "internal" | "external"; panelInsets?: StudioPanelInsets; className?: string; candidateWorkflow?: StudioCandidateWorkflow }
export interface StudioProviderProps extends Omit<StudioProps, "header" | "panelInsets" | "className"> { children: ReactNode }
export interface CompositeStudioProviderProps extends Omit<CompositeStudioProps, "header" | "panelInsets" | "className"> { children: ReactNode }

export interface StudioSessionControls { flush(): Promise<boolean> }

export interface StudioProps extends StudioCanvasProps {
  /** Await before controlled host navigation. Unmount cleanup alone cannot guarantee persistence. */
  sessionRef?: Ref<StudioSessionControls>;
  /** Defaults to the adapter catalog, then the engine's shipped catalog. Its `placements` build the slot tree. */
  catalog?: CatalogData;
  /** Loaded once, when the Studio mounts. Keep it stable. */
  adapter: StudioAdapter;
  labels: StudioLabels;
  /** @default "tokens.accent-color" */
  initialSlotId?: string;
  /** Re-themes the whole document from the working consumer library while mounted. @default true */
  livePreview?: boolean;
  className?: string;
}

/** A snapshot contains host observations, never measurements synthesized by the Studio. */
export interface CompositeStudioSnapshot {
  library: import("../catalog-core/index.js").CompositeLibraryData;
  componentOptions?: import("../catalog-core/index.js").CompositeEngineInput["componentOptions"];
  surfaceOptions?: import("../catalog-core/index.js").CompositeEngineInput["surfaceOptions"];
  fileExists?: import("../catalog-core/index.js").CompositeEngineInput["fileExists"];
  bundles?: import("../catalog-core/index.js").CompositeChangeSet["bundles"];
  surfaceBundles?: import("../catalog-core/index.js").CompositeChangeSet["surfaceBundles"];
  runtime?: import("../catalog-core/index.js").ConsumerRuntimePorts<ReactNode>;
  /** Host preview is separate from conformance evidence. Called only for the inspected leaf. */
  preview?: (leaf: string, profile: import("../catalog-core/index.js").CompositeResolved) => ReactNode | undefined;
}
export interface CompositeStudioAdapter {
  kind: "composite";
  catalog: import("../catalog-core/index.js").CompositeCatalogData;
  contracts?: import("../catalog-core/index.js").BuildCatalogData;
  load(): Promise<CompositeStudioSnapshot>;
  save(changes: import("../catalog-core/index.js").CompositeChangeSet): Promise<StudioWriteResult<import("../catalog-core/index.js").CompositeFinding, import("../catalog-core/index.js").CompositeLibraryData>>;
}
/** Extra chrome is required only by the composite host. */
export interface CompositeStudioLabels extends StudioLabels {
  whole: { signoff: string; proposed: string; contract: string; contentSlots: string; configurations: string; unresolved: string; unassessed: string };
}
export interface CompositeStudioProps extends StudioCanvasProps {
  sessionRef?: Ref<StudioSessionControls>;
  adapter: CompositeStudioAdapter;
  labels: CompositeStudioLabels;
  initialSlotId?: string;
  livePreview?: boolean;
}
export type LegacyStudioProps = StudioProps;
