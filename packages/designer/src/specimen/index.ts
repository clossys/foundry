/**
 * @clossys/designer/specimen: the engine specimen renderers. Registered specimen component leaves, the
 * generated specimen section candidates and the specimen host parts import from here, never from the Studio.
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

export { planSurfacePreviews, SURFACE_SAMPLE_STATES } from "./planned-surface-previews.js";
export type { PlannedSurfacePreview, PlannedSurfacePreviewGap, PlannedSurfacePreviews, PlannedSurfacePreviewsInput, SurfaceSampleState } from "./planned-surface-previews.js";
export { componentSpecimenPreview } from "./component-specimens.js";
export type { ComponentSpecimenBinding, ComponentSpecimenComponent, ComponentSpecimenMember, ComponentSpecimenModule, ComponentSpecimenOptions, ComponentSpecimenPreview, ComponentSpecimenProbe, ComponentSpecimenRefusal, ComponentSpecimenRefusalCode, ComponentSpecimenRender } from "./component-specimens.js";
export type { SpecimenTokenHostParts, SpecimenSwatchHostRequest, SpecimenContrastHostRequest } from "./specimen-token-host-part-types.js";
export { renderSpecimenSwatchHostPart, renderSpecimenContrastHostPart } from "./specimen-token-host-parts.js";
export { STUDIO_SPECIMEN_HOST_PARTS, studioSpecimenTokenStyle } from "../catalog-core/studio-host-parts.js";
export { specimenTokenReference } from "./specimen-token-reference.js";
export { PreviewOutcomeContext } from "./preview-outcome.js";
export type { PreviewFailureReason } from "./preview-outcome.js";
export { COMPONENT_SPECIMEN_PROBE_STATES } from "./component-specimen-samples.js";
export type { ComponentSpecimenProbeState } from "./component-specimen-samples.js";
export { DesignerSpecimen } from "./DesignerSpecimen.js";
export type { DesignerSpecimenContext, DesignerSpecimenProps, DesignerSpecimenNeed, DesignerSurfaceSpecimen } from "./DesignerSpecimen.js";
export { emittedDesignerSpecimenContext } from "./emitted-specimens.js";
export { contentSpecimenLeaves, SpecimenRichPassage, SpecimenCopyInContext, SpecimenPageViewports, contentSpecimenNeeds, richPassageItems, copyInContextItems, pageViewportItems, pageViewportCases } from "./specimen-content.js";
export type { RichPassageValue, CopyInContextValue, PageViewportValue } from "./specimen-content.js";
export type { SpecimenPagePreviewPort, SpecimenPublishedPage } from "./specimen-content-ports.js";
export type { EmittedDesignerSpecimenRuntime } from "./emitted-specimens.js";
export { bindNativeSpecimenContext } from "./emitted-specimens.js";
export { SpecimenLayoutSection, specimenLayoutNeeds } from "./specimen-layouts.js";
export type { SpecimenLayout, SpecimenSpan, SpecimenLeafId, SpecimenAxisValue, SpecimenAxis, SpecimenItem, SpecimenLabels, SpecimenLeafProps, SpecimenLeafDefinition, SpecimenSection, SpecimenRenderParts, SpecimenSurfaceRenderRequest, SpecimenComponentStateRequest, SpecimenContentRenderRequest, SpecimenBreakpointReference, SpecimenNativeViewportRequest, SpecimenPageViewportRequest, SpecimenNativeViewportParts } from "./specimen-layouts.js";
export { SpecimenVariantMatrix, SpecimenSectionViewports, SpecimenFrameViewports, designerViewportSpecimenLeaves, componentSpecimenItems, surfaceSpecimenItems } from "./specimen-viewports.js";
export type { ComponentVariantItem, SurfaceViewportItem, SpecimenItemSet } from "./specimen-viewports.js";
export { SpecimenSwatch, SpecimenColorRamp, SpecimenTypeLadder, SpecimenSpacingLadder, SpecimenRadiusLadder, SpecimenMotionPlayer, SpecimenAssetGrid, SpecimenIconGrid, tokenAssetSpecimenLeaves, tokenSpecimenItems, assetSpecimenItems, colorRampSpecimenItems } from "./specimen-token-assets.js";
export { StudioCopyNeedsError, readStudioCopy, readStudioMessage } from "./copy-binding.js";
export type { StudioCopyBinding, StudioCopyRef, StudioCopyResolver } from "./copy-binding.js";
export { SPECIMEN_KIND_MAP, resolveSpecimenLeafBinding } from "./specimen-kind-map.js";
export type { SpecimenCellKind, SpecimenLeafBinding } from "./specimen-kind-map.js";
export { validateSpecimenCoverage, collectSpecimenDomEvidence } from "./specimen-coverage.js";
export type { SpecimenAgent, SpecimenCoverageCell, RegisteredSpecimenCases, SpecimenCoverageFinding, SpecimenDomCaseEvidence, SpecimenDomEvidence, SpecimenAgentCoverage, SpecimenCoverageReport } from "./specimen-coverage.js";
export { studioSpecimenLeaves, enumerateRegisteredDesignerSpecimenCases } from "./specimen-registry.js";
