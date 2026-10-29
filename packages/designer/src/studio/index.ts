/**
 * @clossys/designer/studio: the library Studio. A consumer adopts source fills into its own library, sees every
 * candidate in its own values and re-themes the page live. The Studio is interactive only (state, effects and a media query),
 * so it has no `/server` entry. All copy comes from `labels`; reading and saving go through the host's `adapter`.
 */
import { version as reactVersion } from "react";
import reactAriaComponentsPackageJson from "react-aria-components/package.json" with { type: "json" };
import { REACT_ARIA_COMPONENTS_DECLARED_RANGE, REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";
import { assertPeerVersion } from "../internal/peer-version.js";

assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });
assertPeerVersion({
  peer: "react-aria-components",
  declaredRange: REACT_ARIA_COMPONENTS_DECLARED_RANGE,
  foundVersion: reactAriaComponentsPackageJson.version,
});

export { Studio } from "./Studio.js";
// Generic boards share the canvas implementation without requiring Studio state.
export {
  CanvasSurface, CanvasLod, CanvasLodLayers, useCanvasLodTier, canvasLodTier,
  CANVAS_LOD_TIERS, CANVAS_LOD_TEXT, CANVAS_LEGIBLE_TEXT_PX,
  CANVAS_ZOOM_VAR, CANVAS_COUNTER_SCALED_TITLE,
} from "./canvas.js";
export type {
  CanvasSurfaceProps, CanvasSurfaceActions, CanvasOverlayInsets, CanvasOverlay, CanvasEdge,
  CanvasPoint, CanvasSize, CanvasRect, CanvasItem, Viewport, Selection, CanvasLodTier,
} from "./canvas.js";
export { StudioProvider } from "./StudioProvider.js";
export { useStudioSession, useOptionalStudioSession } from "./StudioProvider.js";
export { WholeStudioProvider, useWholeStudio, useDesignerLayerBoardProjection } from "./WholeStudioProvider.js";
export type { WholeStudioState } from "./WholeStudioProvider.js";
export { catalogStudioAdapter } from "./catalog-adapter.js";
export { demoStudioAdapter } from "./demo-adapter.js";
export type { StudioSessionControls, StudioWriteResult, StudioAdapter, CompositeStudioAdapter, CompositeStudioSnapshot, CompositeStudioLabels, CompositeStudioProps, CompositeStudioProviderProps, LegacyStudioProps, StudioLabels, StudioProps, StudioProviderProps, StudioCanvasProps, StudioPanelInsets } from "./types.js";

export { StudioTitle } from "./StudioTitle.js";
export { StudioActions, type StudioActionsProps, type StudioOpenTarget, type StudioLaunchResult, type StudioActionNotice } from "./StudioActions.js";
export { buildStudioOpenContext, type StudioOpenContextInput, type StudioOpenContext } from "./open-context.js";
export { studioOpenHrefs } from "./open-targets.js";
export type { StudioCandidateWorkflow, StudioCandidateCheckResult, StudioPendingCandidate } from "./types.js";

export { valueLibraryBoardRecords, valueLibraryBoardPreviews, compositeLibraryBoard } from "./library-board-adapter.js";
export { planSurfacePreviews, SURFACE_SAMPLE_STATES } from "./planned-surface-previews.js";
export type { PlannedSurfacePreview, PlannedSurfacePreviewGap, PlannedSurfacePreviews, PlannedSurfacePreviewsInput, SurfaceSampleState } from "./planned-surface-previews.js";
export type { PreparedLibraryBoardInput, PreparedCompositeLibraryBoardInput } from "./library-board-adapter.js";

// Live component specimens: a host binds its adopted library's modules into `CompositeStudioSnapshot.preview`.
export { componentSpecimenPreview } from "./component-specimens.js";
export type { ComponentSpecimenBinding, ComponentSpecimenComponent, ComponentSpecimenMember, ComponentSpecimenModule, ComponentSpecimenOptions, ComponentSpecimenPreview, ComponentSpecimenProbe, ComponentSpecimenRefusal, ComponentSpecimenRefusalCode, ComponentSpecimenRender } from "./component-specimens.js";
export { COMPONENT_SPECIMEN_PROBE_STATES } from "./component-specimen-samples.js";
export type { ComponentSpecimenProbeState } from "./component-specimen-samples.js";

// The complete-page constructor is private; hosts compose Studio through their route.
export type { DesignerPageProps } from "./system-canvas/DesignerPage.js";
export type { DesignerHistoryRow } from "./system-canvas/inspector/types.js";
export { createRouteStudioLabels } from "./route-labels.js";
export { createStudioUsageLabels } from "./usage/copy-labels.js";
export { StudioCopyNeedsError, readStudioCopy, readStudioMessage } from "./copy-binding.js";
export type { StudioCopyBinding, StudioCopyRef, StudioCopyResolver } from "./copy-binding.js";
export { StudioCopyProvider } from "./copy-context.js";
export { StudioDataValue } from "./data-value.js";
