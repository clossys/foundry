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
export { StudioProvider } from "./StudioProvider.js";
export { useStudioSession, useOptionalStudioSession } from "./StudioProvider.js";
export { WholeStudioProvider, useWholeStudio, useDesignerLayerBoardProjection } from "./WholeStudioProvider.js";
export type { WholeStudioState } from "./WholeStudioProvider.js";
export { StudioHeader, useStudioNavigation } from "./StudioHeader.js";
export { StudioRightPanel } from "./StudioRightPanel.js";
export { catalogStudioAdapter } from "./catalog-adapter.js";
export { demoStudioAdapter } from "./demo-adapter.js";
export type { StudioSessionControls, StudioWriteResult, StudioAdapter, CompositeStudioAdapter, CompositeStudioSnapshot, CompositeStudioLabels, CompositeStudioProps, CompositeStudioProviderProps, LegacyStudioProps, StudioLabels, StudioProps, StudioProviderProps, StudioHeaderProps, StudioCanvasProps, StudioPanelInsets } from "./types.js";

export { StudioTitle } from "./StudioTitle.js";
export { StudioActions, type StudioActionsProps, type StudioOpenTarget, type StudioLaunchResult, type StudioActionNotice } from "./StudioActions.js";
export { buildStudioOpenContext, type StudioOpenContextInput, type StudioOpenContext } from "./open-context.js";
export { studioOpenHrefs } from "./open-targets.js";
export type { StudioCandidateWorkflow, StudioCandidateCheckResult, StudioPendingCandidate } from "./types.js";

export { valueLibraryBoardRecords, valueLibraryBoardPreviews, compositeLibraryBoard } from "./library-board-adapter.js";
export { planSurfacePreviews, SURFACE_SAMPLE_STATES } from "./planned-surface-previews.js";
export type { PlannedSurfacePreview, PlannedSurfacePreviewGap, PlannedSurfacePreviews, PlannedSurfacePreviewsInput, SurfaceSampleState } from "./planned-surface-previews.js";
export type { PreparedLibraryBoardInput, PreparedCompositeLibraryBoardInput } from "./library-board-adapter.js";
