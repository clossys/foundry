import { withA276BackdropGraphic } from "../catalog-assets/a276-backdrop-graphic.contribution.js";
import fill0 from "../catalog/fills/foundry/themes.animate-marquee-vertical.json" with { type: "json" };
import fill1 from "../catalog/fills/foundry/themes.animate-marquee.json" with { type: "json" };
import fill2 from "../catalog/fills/foundry/themes.animate-shiny-text.json" with { type: "json" };
import fill3 from "../catalog/fills/shadcn-aria/themes.accent-foreground.json" with { type: "json" };
import fill4 from "../catalog/fills/shadcn-aria/themes.accent.json" with { type: "json" };
import fill5 from "../catalog/fills/shadcn-aria/themes.background.json" with { type: "json" };
import fill6 from "../catalog/fills/shadcn-aria/themes.border.json" with { type: "json" };
import fill7 from "../catalog/fills/shadcn-aria/themes.card-foreground.json" with { type: "json" };
import fill8 from "../catalog/fills/shadcn-aria/themes.card.json" with { type: "json" };
import fill9 from "../catalog/fills/shadcn-aria/themes.chart-1.json" with { type: "json" };
import fill10 from "../catalog/fills/shadcn-aria/themes.chart-2.json" with { type: "json" };
import fill11 from "../catalog/fills/shadcn-aria/themes.chart-3.json" with { type: "json" };
import fill12 from "../catalog/fills/shadcn-aria/themes.chart-4.json" with { type: "json" };
import fill13 from "../catalog/fills/shadcn-aria/themes.chart-5.json" with { type: "json" };
import fill14 from "../catalog/fills/shadcn-aria/themes.destructive.json" with { type: "json" };
import fill15 from "../catalog/fills/shadcn-aria/themes.foreground.json" with { type: "json" };
import fill16 from "../catalog/fills/shadcn-aria/themes.input.json" with { type: "json" };
import fill17 from "../catalog/fills/shadcn-aria/themes.muted-foreground.json" with { type: "json" };
import fill18 from "../catalog/fills/shadcn-aria/themes.muted.json" with { type: "json" };
import fill19 from "../catalog/fills/shadcn-aria/themes.popover-foreground.json" with { type: "json" };
import fill20 from "../catalog/fills/shadcn-aria/themes.popover.json" with { type: "json" };
import fill21 from "../catalog/fills/shadcn-aria/themes.primary-foreground.json" with { type: "json" };
import fill22 from "../catalog/fills/shadcn-aria/themes.primary.json" with { type: "json" };
import fill23 from "../catalog/fills/shadcn-aria/themes.radius.json" with { type: "json" };
import fill24 from "../catalog/fills/shadcn-aria/themes.ring.json" with { type: "json" };
import fill25 from "../catalog/fills/shadcn-aria/themes.secondary-foreground.json" with { type: "json" };
import fill26 from "../catalog/fills/shadcn-aria/themes.secondary.json" with { type: "json" };
import fill27 from "../catalog/fills/shadcn-aria/themes.sidebar-accent-foreground.json" with { type: "json" };
import fill28 from "../catalog/fills/shadcn-aria/themes.sidebar-accent.json" with { type: "json" };
import fill29 from "../catalog/fills/shadcn-aria/themes.sidebar-border.json" with { type: "json" };
import fill30 from "../catalog/fills/shadcn-aria/themes.sidebar-foreground.json" with { type: "json" };
import fill31 from "../catalog/fills/shadcn-aria/themes.sidebar-primary-foreground.json" with { type: "json" };
import fill32 from "../catalog/fills/shadcn-aria/themes.sidebar-primary.json" with { type: "json" };
import fill33 from "../catalog/fills/shadcn-aria/themes.sidebar-ring.json" with { type: "json" };
import fill34 from "../catalog/fills/shadcn-aria/themes.sidebar.json" with { type: "json" };
import fill35 from "../catalog/fills/tailwind-default/themes.font-heading.json" with { type: "json" };
import fill36 from "../catalog/fills/tailwind-default/themes.font-mono.json" with { type: "json" };
import fill37 from "../catalog/fills/tailwind-default/themes.font-sans.json" with { type: "json" };
import fill38 from "../catalog/fills/tailwind-default/themes.font-serif.json" with { type: "json" };
import fill39 from "../catalog/fills/tailwind-default/themes.shadow.json" with { type: "json" };
import fill40 from "../catalog/fills/tailwind-default/themes.spacing.json" with { type: "json" };
import fill41 from "../catalog/fills/tailwind-default/themes.tracking-tight.json" with { type: "json" };
import source0 from "../catalog/sources/carbon-colors.json" with { type: "json" };
import source1 from "../catalog/sources/foundry-baseline.json" with { type: "json" };
import source2 from "../catalog/sources/foundry.json" with { type: "json" };
import source3 from "../catalog/sources/radix-colors.json" with { type: "json" };
import source4 from "../catalog/sources/shadcn-aria.json" with { type: "json" };
import source5 from "../catalog/sources/tailwind-default.json" with { type: "json" };
import standard0 from "../catalog/standards/apg.json" with { type: "json" };
import standard1 from "../catalog/standards/dtcg.json" with { type: "json" };
import standard2 from "../catalog/standards/tailwind-v4-theme.json" with { type: "json" };
import standard3 from "../catalog/standards/wcag-2.2.json" with { type: "json" };
import standard4 from "../catalog/standards/web-app-manifest.json" with { type: "json" };
import slots from "../catalog/slots/themes.json" with { type: "json" };
import themePlacement from "../catalog/ia/themes.json" with { type: "json" };
import retired from "../catalog/retired.json" with { type: "json" };
import lucideSource from "../catalog/sources/lucide.json" with { type: "json" };
import { parseFill } from "./cell.js";
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import framePlacement from "../catalog/ia/frames.json" with { type: "json" };
import frameRetired from "../catalog/retired/frames.json" with { type: "json" };
import { loadComponentRegistry } from "./component-registry.js";
import { loadSectionRegistry } from "./sections-contract.js";
import { assertIAPlacements } from "./ia-placement.js";
import { assertFrozenLeafSets } from "./leaf-freeze.js";
import { withAssetCatalog } from "../catalog-assets/catalog.js";
import type { BuildCatalogData, CatalogData, FillDoc, FrameSlot, Placement, Retired, Slot, Source, Standard, CatalogRule } from "./types.js";
export * from "./types.js";
export * from "./breakpoints.js";
export { validateSelectionStrategy } from "./selection-strategy.js";
export type { SelectionCellRef, SelectionStrategy, SelectionStrategyReader, SelectionStrategyResult } from "./selection-strategy.js";
export * from "./library-roster.js";
export * from "./component-registry.js";
export * from "./ia-placement.js";
export * from "./leaf-freeze.js";
export * from "./sections-contract.js";
export * from "./section-copy.js";
export type { FrameContract, LandmarkSpec } from "./frames-contract.js";
export * from "./api.js";
export * from "./ids.js";
export * from "./cell.js";
export * from "./stable.js";
export * from "../catalog-assets/index.js";
export function loadCatalog(reportLeafFreeze?: Parameters<typeof assertFrozenLeafSets>[3]): CatalogData {
  const fills = [fill0, fill1, fill2, fill3, fill4, fill5, fill6, fill7, fill8, fill9, fill10, fill11, fill12, fill13, fill14, fill15, fill16, fill17, fill18, fill19, fill20, fill21, fill22, fill23, fill24, fill25, fill26, fill27, fill28, fill29, fill30, fill31, fill32, fill33, fill34, fill35, fill36, fill37, fill38, fill39, fill40, fill41].map(value => {
    const parsed = parseFill(value);
    const error = parsed.findings.find(finding => finding.severity === "error");
    if (error) throw new Error("catalog: " + error.message);
    return parsed.fill as FillDoc;
  });
  fills.sort((a, b) => {
    const left = a.$extensions["com.clossys.fill"].id;
    const right = b.$extensions["com.clossys.fill"].id;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const catalog = withA276BackdropGraphic(withAssetCatalog({
    slots: slots as unknown as readonly Slot[],
    standards: [standard0, standard1, standard2, standard3, standard4] as unknown as readonly Standard[],
    sources: [source0, source1, source2, source3, source4, source5, lucideSource] as unknown as readonly Source[],
    rules: [] as unknown as readonly CatalogRule[],
    fills,
    placements: [themePlacement] as unknown as readonly Placement[],
    retired: retired as unknown as readonly Retired[],
  }));
  assertFrozenLeafSets(catalog.placements, catalog.slots, ["themes", "assets"], reportLeafFreeze);
  assertIAPlacements(catalog.placements, catalog.slots);
  return structuredClone(catalog);
}

/** Inspect all registered build IA without extending the theme/asset runtime engine. */
export function loadBuildCatalog(reportLeafFreeze?: Parameters<typeof assertFrozenLeafSets>[3]): BuildCatalogData {
  const catalog = loadCatalog(reportLeafFreeze);
  const components = loadComponentRegistry(reportLeafFreeze);
  const sections = loadSectionRegistry();
  const build: BuildCatalogData = {
    ...catalog,
    slots: [...catalog.slots, ...components.slots, ...sections.slots, ...structuredClone(frameSlots) as unknown as readonly FrameSlot[]],
    placements: [...catalog.placements, components.placement, sections.placement, structuredClone(framePlacement) as Placement],
    aliases: [...components.aliases, ...sections.aliases, ...frameRetired.map(entry => ({ id: entry.id, target: entry.replacedBy }))],
    retiredByLayer: { sections: sections.retired, frames: structuredClone(frameRetired) as readonly Retired[] },
    registryStatus: components.status,
  };
  assertFrozenLeafSets(build.placements, build.slots, ["themes", "assets", "components"], reportLeafFreeze);
  assertIAPlacements(build.placements, build.slots);
  return build;
}
// Later component consumption, checking, resolution, emission and source importers
// export their implemented APIs here when available; this registry supplies no runtime stubs.

export { materializeSourceFill } from "./changeset-components.js";
export type { SourceBundle, ComponentTransform, ComponentFetchPort, ComponentOperation } from "./changeset-components.js";
export type { ComponentCandidate, ComponentCandidateDocument, ComponentDocument, ComponentFile, ComponentOrigin, ComponentCatalog, ComponentLibrary, ComponentRule, ResolvedComponent, ResolvedComponents, ComponentResolutionInput } from "./resolve-components.js";
export { componentSourceHash, componentTokensHash } from "./check-components.js";
export { emittedTokenProperties, emittedTokenManifest } from "./emit.js";
export type { EmittedTokenManifest, EmittedTokenDefinition } from "./emit.js";
export type { ComponentCheckInput, ComponentObservation, ComponentMeasurement, ComponentFinding, ComponentCheckResult } from "./check-components.js";
export { buildComponentsConsumption, scanComponentReads } from "./consumption.js";
export type { ConsumptionReads, ConsumptionToken, ConsumptionBlocker, ConsumptionFill, ConsumptionSourceScan, ConsumptionCoverage, ConsumptionReceipt, ConsumptionInput, ConsumptionFinding } from "./consumption.js";
/** Cross-layer usage graph derived from the consumption producers and route bindings. */
export { buildUsageGraph, uses, usedBy, closure, graphFindings } from "./usage-graph.js";
export type { UsageGraph, UsageGraphInputs, UsageGraphFill, UsageGraphFinding, UsageNode, UsageEdge, UsageEdgeSite, UsageLayer, UsageEdgeKind, UsageEvidence, UsageDirection, UsageReverseComposes, UsageBindingLike, UsageFillSelectionLike, UsageRuntimeObservation } from "./usage-graph.js";
/** Static wiring checks above Components (WL2, WL3, WL4, WL8, WL9, WL10) and the wiring-exception reader. */
export { checkWiring, readWiringExceptions, wiringScope, foundryWiringExceptions, WIRING_REASON_CODES, WIRING_HEADLESS_MODULES } from "./wiring.js";
export type { WiringCode, WiringReasonCode, WiringException, WiringExceptionStatus, WiringExceptionState, WiringFinding, WiringLayer, WiringSource, WiringSurfaceFill, WiringGeneratedArtifact, WiringRoutes, WiringCheckedProvider, WiringProviderProof, WiringInput, WiringResult } from "./wiring.js";
/** DOM provenance stamps (data-ds-layer/leaf/fill) and the runtime WL scanner (WL1, WL5, WL6, WL7). */
export { dsAttrs, dsPassThrough, withoutDsAttrs, DS_ATTR, DS_LAYERS } from "./provenance-attrs.js";
export type { DsAttrs, DsLayer } from "./provenance-attrs.js";
export { scanProvenance, PROVENANCE_FINDING_CODES } from "./provenance-scan.js";
export type { ProvenanceScan, ProvenanceScanInput, ProvenanceFinding, ProvenanceFindingCode, ProvenanceSurfaceBinding } from "./provenance-scan.js";

export * from "./runtime-ports.js";
export * from "./runtime-assembly.js";
export * from "./runtime-assembly-evidence.js";
export * from "./surface-runtime-manifest.js";

/** Pure candidate inventory; consumer ownership and checks stay with the composite API. */
export { importFoundryComponents } from "../importers/foundry-components.js";
export type { FoundryComponentImportInput, FoundryComponentImport, FoundryComponentCoverage, FoundryComponentFillDoc } from "../importers/foundry-components.js";

export { loadComponentCompositionRules } from "./component-compositions.js";
export { planComponentDefaults, DEFAULT_COMPONENT_PREFERENCE, DEFAULT_COMPONENT_PICKS, DEFAULT_COMPONENT_FALLBACK } from "./component-defaults.js";
export { observeComponentSources } from "./component-observations.js";
export { joinComponentQualification } from "./component-qualification.js";
export type { ComponentQualificationJoinInput, ComponentQualificationJoinRecord, ComponentQualificationJoin } from "./component-qualification.js";
export { bindCompiledClasses } from "./component-class-bindings.js";
export type { ComponentObservationInput, ComponentObservationProbe, ComponentObservationResult, ComponentBrowserArtifact } from "./component-observations.js";
export type { ComponentDefaultsInput, ComponentDefaultsPlan, ComponentDefaultRow, ComponentDefaultBasis } from "./component-defaults.js";
/** Pure Sections/Frames candidate inventories and their default-fill planner. */
export { importFoundrySections } from "../importers/foundry-sections.js";
export type { FoundrySectionImportInput, FoundrySectionImport, FoundrySectionCoverage, FoundrySectionFillDoc, FoundrySectionDescriptor } from "../importers/foundry-sections.js";
export { importFoundryFrames } from "../importers/foundry-frames.js";
export { loadFoundrySurfaceHistory } from "../importers/foundry-surface-history.js";
export type { FoundryFrameInput, FoundryFrameCoverage, FoundryFrameFillDoc, FoundryFrameDescriptor } from "../importers/foundry-frames.js";
export { planSurfaceDefaults } from "./surface-defaults.js";
export type { SurfaceDefaultsInput, SurfaceDefaultsPlan, SurfaceDefaultRow, SurfaceDefaultBasis, SurfaceDefaultDecision, SurfaceDefaultDescriptor, SurfaceDefaultCandidateDocument } from "./surface-defaults.js";

export { materializeSurfaceSourceFill } from "./surface-materialize.js";
export { resolveSurfacePackageDescriptor, surfaceContractDiff } from "./surface-library.js";
export type { SurfacePackagePin, SurfacePackageOrigin, SurfacePackageEntry, SurfacePackageDocument, SurfacePackageRegistration, SurfaceContractDiff } from "./surface-types.js";
export type { SurfaceSlot, SurfaceFile, SurfaceFileHash, SurfacePin, SurfaceApi, SurfacePropBinding, SurfaceLiteralBinding, SurfaceConfig, SurfaceComponentBinding, SurfaceDependency, SurfaceBase, SurfaceInputRef, SurfaceInputIdentity, SurfaceRuleIdentity, SurfaceOrigin, SurfaceEntryBase, SurfaceSectionEntry, SurfaceFrameEntry, SurfaceCandidate, SurfaceCandidateDocument, SurfaceDocument, SurfaceLibraryPortion, SurfacePackageEvidence, SurfaceCommandReceipt, SurfaceMeasurement, SurfaceResolutionOptions, SurfaceApplyOptions, SurfaceFinding, SurfaceCheckResult, SurfaceResolvedFill, SurfaceResolved, SurfaceOperation, SurfaceTransformResult, SurfaceTransform, SurfaceRule, SurfaceCatalog, SurfaceFetchPort, SurfaceMaterializationInput, SurfaceSourceBundle, SurfaceSelection, SurfaceEmitTarget, SurfaceRuntimeIdentity, SurfaceMaterializationReceipt } from "./surface-types.js";
export { SPECIMEN_SECTION_EXPORTS, specimenSectionSourceCatalog } from "../importers/specimen-sections.js";

export * from "./full-library-runtime.js";

export * from "./body-substrate.js";

/** IA navigation and guidance selection belong to the public catalog API. */
export { COMPONENT_DISPLAY_TREE } from "../catalog/display.js";
export type { ComponentDisplayTree } from "../catalog/display.js";
export { resolveComponentId } from "../catalog/component-aliases.js";
export { componentSelection } from "../catalog/component-selection.js";
