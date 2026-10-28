import type { CanvasFilter } from "./canvas-model.js";
import type { CSSProperties, ReactNode, Ref } from "react";
import type { CheckCategory } from "./matrix-model.js";
import type { CatalogData, ChangeSet, Finding, LibraryData, Selection } from "../catalog-core/index.js";

export type StudioWriteResult<F = Finding, L = LibraryData> = { ok: true; library: L } | { ok: false; reason: "unavailable" | "conflict" | "invalid" | "failed"; findings?: readonly F[] };

/** How the Studio reads a consumer's library. The host supplies it; the Studio never touches files or the network. */
export interface StudioAdapter {
  /** Optional catalog carried by a read-only preview adapter. An explicit Studio catalog takes precedence. */
  catalog?: CatalogData;
  /** Called once on mount. selection is a compatibility field; fills are authoritative. */
  load(): Promise<{ library: LibraryData; selection?: Selection }>;
  /**
   * @deprecated Ignored. The Designer is read-only: no rendered control, shortcut or blur calls it. Every change
   * goes through a coding agent running the designer skill; kept optional so an existing adapter still type-checks.
   */
  save?(changes: ChangeSet): Promise<StudioWriteResult & { selection?: Selection }>;
}

/** All chrome copy. The Studio has no English of its own. */
export interface StudioLabels {
  board: {
    /** @deprecated Ignored: the board has no edit mode. */ changeSelection?: string; /** @deprecated Ignored: the board has no edit mode. */ done?: string;
    notChosen: string; /** @deprecated Ignored: a not-chosen row offers Ask agent only. */ choose?: string; askAgent: string; /** @deprecated Ignored: the edit-mode Custom column is gone. */ custom?: string; create: string; refresh: string; promptTitle: string; promptInstruction: string; returnStep: string; copy: string; copied: string; copyFailed: string; close: string; checkCandidates: string; checking: string; candidatesUnavailable: string; candidatesFailed: string; pendingSelection: string; noNewCandidates: string; /** @deprecated Ignored: Generate starter is gone; a coding agent authors a starter. */ generateStarter?: string };
  canvas: { noCandidatesInBoard: string; label: string; hint: string; search: string; explorerOpen: string; explorerClose: string; inspectorClose: string; minimap: string; filters: Record<CanvasFilter, string>; zoomLabel: string; zoomIn: string; zoomOut: string; fit: string; zoom: (percent: number) => string; openBoard: (name: string) => string; goToBoard: (name: string) => string };
  layers: { label: string; tokens: string; assets: string; components: string; sections: string; frames: string; disabled: string };
  scorecard: { title: string; close: string; resolved: string; checks: string; issues: string; noIssues: string; target: string; categories: Record<CheckCategory, string>; counts: (errors: number, notices: number) => string; supported: (codes: readonly string[]) => string };
  matrix: { label: string; leaf: string; libraries: string; showAll: string; expand: (leaf: string) => string; collapse: (leaf: string) => string; differs: string; pending: string };
  /**
   * The right rail of cards (Explorer, Inspector, Canvas map, Zoom): its landmark name, the show and hide
   * controls for the whole rail, and the Inspector card's hint while no leaf is selected.
   */
  rail: { label: string; show: string; hide: string; inspectorEmpty: string };
  treeLabel: string;
  stageLabel: string;
  inspectorLabel: string;
  /** @deprecated Ignored: the Use radios are gone. */
  useGroup?: string;
  /** @deprecated Ignored: the Use radios are gone. */
  useSource?: (source: string, target: string) => string;
  /** Available members from the contract and loaded fills, including members without a visual preview. */
  memberCount: (count: number) => string;
  /** @deprecated Ignored: the "Apply to" scope control is gone. */
  scope?: { explanation: string; label: string; member: string; slot: string; node: string; memberPicker: string; nodePicker: string };
  /** One-line status of a card. An empty string renders no board check line. */
  checkSummary: (errors: number, notices: number) => string;
  /** Neutral count of statically eligible fills awaiting runtime qualification (never counted as errors). Omitted: "N runtime pending". */
  runtimePending?: (count: number) => string;
  /** Plain words for an engine exemption notice (e.g. kind "logotype"). Omitted: "<Kind> exemption: <reason>". */
  assetExemption?: (kind: string, reason: string) => string;
  /** Plain "n of m chosen" board summary line. Omitted: no chosen line. */
  chosenSummary?: (chosen: number, total: number) => string;
  /** Human name for a leaf id, shown above the id (in the mono face) in a board row. Omitted or undefined: the id alone. */
  leafName?: (id: string) => string | undefined;
  /** Status beside a planned (not adopted) Sections/Frames preview. Omitted: "Planned default, not adopted". */
  plannedPreview?: string;
  previewUnavailable: string;
  visualPreviewUnsupported: string;
  referenceOnly: string;
  inUseByDefault: string;
  noFill: string;
  /** @deprecated Ignored: the Designer never saves, so it has no save status, undo, redo or conflict controls. */
  autosave?: { saving: string; saved: string; notSaved: string; retry: string; undo: string; redo: string; changedElsewhere: string; keepMine: string; takeTheirs: string };
  /** @deprecated Ignored: Reset to default is gone. */
  resetToDefault?: string;
  /** @deprecated Ignored: the Designer never saves. */
  saveFailed?: { unavailable: string; conflict: string; invalid: string; failed: string };
  /**
   * The inspector's one read-only change line: how to hand a change to a coding agent (the designer skill).
   * Omitted: no line is shown.
   */
  howToChange?: string;
  loading: string;
  loadFailed: string;
  /**
   * @deprecated Ignored. Token specimens draw the shared specimen dataset's sample text, so host copy never
   * replaces it; kept optional so an existing labels object still type-checks.
   */
  sampleText?: string;
  fontNotLoaded: string;
  inspector: { representedLeaf: string; trust: string; usedBy: string; none: string; source: string; mode: string; licence: string; pin: string; status: string; evidence: string; members: string; findings: string; via: string; light: string; dark: string; alias: string; builtOn: string; relation: string };
  /** Copy for the Usage area in every inspector (Using what, Used where, OWN-1). Omitted: no Usage area is shown. */
  usage?: import("./usage/UsagePanel.js").UsagePanelLabels;
}

export interface StudioPanelInsets {
  blockStart?: CSSProperties["insetBlockStart"]; blockEnd?: CSSProperties["insetBlockEnd"]; inlineStart?: CSSProperties["insetInlineStart"]; inlineEnd?: CSSProperties["insetInlineEnd"];
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
export interface StudioCanvasProps {
  /** @deprecated Ignored: the Studio has no layer tabs; the right rail's Explorer card switches layers. */
  header?: "internal" | "external";
  panelInsets?: StudioPanelInsets; className?: string; candidateWorkflow?: StudioCandidateWorkflow }
export interface StudioProviderProps extends Omit<StudioProps, "header" | "panelInsets" | "className"> { children: ReactNode }
export interface CompositeStudioProviderProps extends Omit<CompositeStudioProps, "header" | "panelInsets" | "className"> { children: ReactNode }

/** @deprecated The Designer holds no unsaved edits, so there is nothing to flush. */
export interface StudioSessionControls { flush(): Promise<boolean> }

export interface StudioProps extends StudioCanvasProps {
  /** @deprecated Ignored: the Designer holds no unsaved edits. */
  sessionRef?: Ref<StudioSessionControls>;
  /** Defaults to the adapter catalog, then the engine's shipped catalog. Its `placements` build the slot tree. */
  catalog?: CatalogData;
  /** Loaded once, when the Studio mounts. Keep it stable. */
  adapter: StudioAdapter;
  labels: StudioLabels;
  /** @default "tokens.accent-color" */
  initialSlotId?: string;
  /** @deprecated Ignored: there is no unsaved working state to preview. */
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
  /** Preview-only renderings of planned Sections/Frames defaults (planSurfacePreviews). Never adopts, chooses or counts a leaf. */
  plannedPreviews?: import("./planned-surface-previews.js").PlannedSurfacePreviews;
  /** The consumer's committed usage graph (`library/usage-graph.json`), re-derived with each selection. Omitted: the committed Foundry graph. */
  usageGraph?: import("../catalog-core/index.js").UsageGraph;
}
export interface CompositeStudioAdapter {
  kind: "composite";
  catalog: import("../catalog-core/index.js").CompositeCatalogData;
  contracts?: import("../catalog-core/index.js").BuildCatalogData;
  load(): Promise<CompositeStudioSnapshot>;
  /** @deprecated Ignored. The Designer is read-only; changes go through a coding agent. */
  save?(changes: import("../catalog-core/index.js").CompositeChangeSet): Promise<StudioWriteResult<import("../catalog-core/index.js").CompositeFinding, import("../catalog-core/index.js").CompositeLibraryData>>;
}
/** Extra chrome is required only by the composite host. */
export interface CompositeStudioLabels extends StudioLabels {
  whole: { signoff: string; proposed: string; contract: string; contentSlots: string; configurations: string; unresolved: string; unassessed: string };
}
export interface CompositeStudioProps extends StudioCanvasProps {
  /** Checked finite initial snapshot/session from the server-safe studio/queries API. */
  initialSession?: import("./initial-session.js").WholeStudioInitialSession;
  /** @deprecated Ignored: the Designer holds no unsaved edits. */
  sessionRef?: Ref<StudioSessionControls>;
  adapter: CompositeStudioAdapter;
  labels: CompositeStudioLabels;
  initialSlotId?: string;
  /** @deprecated Ignored: there is no unsaved working state to preview. */
  livePreview?: boolean;
}
export type LegacyStudioProps = StudioProps;
