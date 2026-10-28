/**
 * @clossys/publisher/core — public composition contract. See README.md
 * for the full picture: the join point between
 * `@clossys/designer`'s visual vocabulary and `@clossys/writer`'s
 * verbal one, plus per-channel metadata; the renderer-facing `ComposeDocument`
 * contract, and why `layout` is channel-gated.
 *
 * Everything here is pure — no I/O, no React, no schema library, and no
 * dependency on `@clossys/designer` or `@clossys/writer`
 * themselves (see the README, "Zero runtime dependencies"). Four things
 * ship:
 *
 *   1. THE CONTRACT (`types.ts`) — `ComposeDocument` and every shape it's
 *      built from.
 *   2. VALIDATION (`validate.ts`) — `validateComposeDocument`, hand-rolled
 *      shape validation in the style of `@example/strategy`'s
 *      `validation.ts` and `@clossys/writer`'s `schema.ts`.
 *   3. RESOLUTION (`resolve.ts`, `resolve-copy.ts`, `resolve-assets.ts`) —
 *      `resolveDocument`, matching a document's bindings against a real
 *      layout's slots (reusing `validate.ts`'s own binding-shape checks
 *      so a malformed binding can never resolve `ok: true` — see issue
 *      #43); `resolveCopy`, the second pass that turns matched
 *      `copyId`/`value` bindings into actual text via a caller-supplied
 *      `CopyLookup`; and `resolveAssets`, its symmetric companion (added
 *      0.3.0) that turns matched `assetId` bindings into actual assets
 *      via a caller-supplied `AssetLookup`. Each of the latter two defers
 *      the other's bindings rather than treating them as failures — see
 *      `resolve-copy.ts`'s own top comment, "Asset bindings are not
 *      failed text".
 *   4. UNIT CONVERSION AND SMALL HELPERS (`frame.ts`, `slots.ts`) — the
 *      two conversions renderers need out of a `Frame`, plus small
 *      read-only lookups over a `LayoutSpec`'s `slots`.
 */

export type {
  Channel,
  ChannelMeta,
  CanvasLayoutSpec,
  CopyProvenance,
  ComposeDocument,
  ComposeFinding,
  ElementKind,
  EmailMeta,
  Frame,
  FlowLayoutSpec,
  FlowSlotSpec,
  ImageMeta,
  LayoutSpec,
  OutputArtifact,
  OutputManifest,
  PrintMeta,
  Rect,
  ResolvedSlot,
  ResolveResult,
  SlidesMeta,
  SlotBinding,
  SurfaceBinding,
  SurfaceChannelMeta,
  SurfaceDocument,
  SurfaceEmailMeta,
  SurfaceImageMeta,
  SurfaceRepeatingSlotBinding,
  SurfaceRepeatingSlotFieldBinding,
  SurfaceSlotBinding,
  SurfaceSlotBindingItem,
  SurfaceSlidesMeta,
  SurfaceSlotSpec,
  SurfaceWebMeta,
  SlotSpec,
  StyleBinding,
  StrategyProvenance,
  WebMeta,
} from "./types.js";

export { CHANNELS, ELEMENT_KINDS } from "./types.js";

export { validateComposeDocument } from "./validate.js";
export { validateSurfaceDocument, isSurfaceRepeatingSlotBinding } from "./validate.js";

export {
  findPublicationMapEntryByPath,
  findPublicationMapEntryBySlideIndex,
  listPublicationMapPaths,
  validatePublicationMap,
  validatePublicationMapRoutes,
} from "./publication-map.js";
export type { PublicationMap, PublicationMapEntry, PublicationMapLocation } from "./publication-map.js";

export { resolveDocument } from "./resolve.js";

export { resolveCopy } from "./resolve-copy.js";
export type { CopyLookup, CopyResolveResult, ResolvedText } from "./resolve-copy.js";

export { resolveAssets } from "./resolve-assets.js";
export type { AssetLookup, AssetResolveResult, ResolvedAsset } from "./resolve-assets.js";

export { frameToInches, frameToPercent } from "./frame.js";
export type { CanvasInches } from "./frame.js";

export { getSlotSpec, listSlotKeys, requiredSlotKeys } from "./slots.js";

export { collectCopyProvenance, createOutputManifest, createResolvedOutputManifest } from "./output-manifest.js";

export { resolveSurfaceDocument, SurfaceResolutionError } from "./resolve-surface.js";
export { checkSectionVariety, CONTENT_ICON_NAMES, CONTENT_ITEM_EYEBROW_MAX_CHARACTERS, resolveSectionedViewDocument, SectionedViewResolutionError, validateSectionedViewDocument } from "./sectioned-view.js";
export type {
  ResolvedSectionedViewAction,
  ResolvedSectionedViewContentAction,
  ResolvedSectionedViewDocument,
  ResolvedSectionedViewSection,
  SectionedViewAction,
  SectionedViewActionEmphasis,
  SectionedViewDocument,
  SectionedViewFaqItem,
  SectionedViewFaqSection,
  SectionedViewFeatureGridSection,
  SectionedViewFeatureItem,
  SectionedViewGround,
  SectionedViewHeroMedia,
  SectionedViewHeroSection,
  SectionedViewStatGridSection,
  SectionedViewStatItem,
  SectionedViewStatTrend,
  ResolvedSectionedViewHeroMedia,
  SectionedViewOrderedStep,
  SectionedViewOrderedStepSequenceSection,
  SectionedViewPricingItem,
  SectionedViewPricingSection,
  SectionedViewResolutionReason,
  SectionedViewSection,
  SectionedViewSectionGroundRhythm,
  SectionedViewSectionKind,
  SectionedViewStatSection,
  SectionedViewStatSectionItem,
  SectionedViewTestimonialItem,
  SectionedViewTestimonialSection,
  SectionedViewStatus,
  SectionedViewStatusDisposition,
  SectionedViewStatusGroup,
  SectionedViewStatusItem,
  SectionedViewStatusListSection,
  ContentIconName,
  ResolvedSectionedViewContentBlock,
  ResolvedSectionedViewContentSection,
  ResolvedSectionedViewSpecimenMedia,
  ResolvedSectionedViewMedia,
  ResolvedSectionedViewSpecimenPanel,
  ResolvedSectionedViewSpecimenPart,
  SectionedViewContentAction,
  SectionedViewContentActionEmphasis,
  SectionedViewContentFootnote,
  SectionedViewContentFootnoteLink,
  SectionedViewContentLayout,
  SectionedViewContentBlock,
  SectionedViewContentBlockType,
  SectionedViewContentSection,
  SectionedViewSpecimenAssignee,
  SectionedViewSpecimenField,
  SectionedViewSpecimenFieldsPart,
  SectionedViewSpecimenFile,
  SectionedViewSpecimenFilesPart,
  SectionedViewSpecimenFooter,
  SectionedViewSpecimenMedia,
  SectionedViewSpecimenMeterPart,
  SectionedViewSpecimenPanel,
  SectionedViewSpecimenPart,
  SectionedViewSpecimenPartType,
  SectionedViewSpecimenScheduleItem,
  SectionedViewSpecimenSchedulePart,
  SectionedViewSpecimenShare,
  SectionedViewSpecimenSharesPart,
  SectionedViewSpecimenStatus,
  SectionedViewSpecimenStatusRow,
  SectionedViewSpecimenStatusRowsPart,
  SectionedViewSpecimenTableCell,
  SectionedViewSpecimenTableColumn,
  SectionedViewSpecimenTablePart,
  SectionedViewSpecimenTableRow,
  SectionedViewSpecimenTone,
} from "./sectioned-view.js";
export type { ResolvedSurfaceDocument, ResolvedSurfaceGroup, ResolvedSurfaceGroupField, ResolvedSurfaceGroupItem, ResolvedSurfaceNode, ResolveSurfaceDocumentOptions, SurfaceResolutionReason } from "./resolve-surface.js";

export { checkPageFlow, sectionWeight, resolveActionEmphasis } from "./page-flow.js";
export type { CheckPageFlowOptions, SectionShape, SectionWeight, SectionedViewFlowWarning } from "./page-flow.js";

export * from "./content-contract.js";
export * from "./content-asset.js";
export { validateBlockRole } from "./block-role.js";
export type {
  BlockRole, BlockRoleClaim, BlockRoleMedium, BlockRoleConfigValue,
  BlockRoleAdapter, BlockRoleRegion, BlockRoleDescriptor,
  BlockRoleAdapterContract, BlockRoleReason, BlockRoleValidationResult,
} from "./block-role.js";
export { validateBlockRoleBinding } from "./block-role-binding.js";
export type {
  InstanceBlockBinding, BlockRoleBindingRefIdentity, BlockRoleBindingIdentity,
  BlockRoleBindingReason, BlockRoleBindingValidationResult,
} from "./block-role-binding.js";
export { WEB_ROLE_PAIR_BINDINGS, WEB_ROLE_PAIR_EVIDENCE, validateWebRolePairEvidence } from "./web-role-pair-evidence.js";
export type {
  WebRolePairStatus, WebRolePairCheck, WebRolePairEvidence, WebRolePairEvidenceResult,
} from "./web-role-pair-evidence.js";
export { validateRelations } from "./relations.js";
export type {
  RelationIdentity, RelationNodeKind, RelationNode, RelationRouteBinding, RelationEndpoint,
  RelationProvenance, RelationEdge, RelationsInput, RelationsGraph, RelationsReason, RelationsResult,
} from "./relations.js";
export {
  INSTANCE_FRAME_BLOCK_IDS, INSTANCE_VIEW_BLOCK_IDS, INSTANCE_SITE_SURFACE_KINDS,
  validateInstanceRecord, validatePackRecord, validateInstanceRecords,
} from "./instance-record.js";
export type {
  InstanceFrameBlockId, InstanceViewBlockId, InstanceSiteSurfaceKind, InstanceBlockRef,
  InstanceRecord, PackRecord, InstanceRecordOptions, InstanceRecordReason, InstanceRecordValidationResult,
} from "./instance-record.js";
export { STANDARD_WEBSITE_INSTANCES, STANDARD_WEBSITE_PACK } from "./standard-website-pack.js";

export { PUBLISHER_MENU_VERSION, PUBLISHER_MENU, PUBLISHER_MILESTONES, PUBLISHER_PACKS, PUBLISHER_LANES } from "../planning/menu.js";
export type { MilestoneId, PublisherMenuItem, PublisherPlanLane, PublisherPlanPackId, MenuNeeds } from "../planning/menu.js";
export { createPublisherPlanDraft, validatePublisherPlan } from "../planning/plan.js";
export type { PublisherPlanDraft, PublisherPlanMilestone, PublisherPlanPack, PublisherPlanItem, PublisherPlanNeed, PublisherPlanFinding } from "../planning/plan.js";
export { PublisherPlanStore, alignedPlanItems, projectPlanInstances } from "../planning/change-set.js";
export type { PublisherPlanVersion, PublisherPlanChangeSet, PublisherPlanApply, AlignedPlanItem } from "../planning/change-set.js";

export { menuConfiguration, recommendPlanItem, withPublisherConfiguration, validatePublisherConfiguration, checkPublisherMenu, configurationInputNeeds, derivePublisherDeliveryState } from "../planning/configuration.js";
export type { PublisherConfiguration, PublisherMediaSettings, PublisherLaneRecommendation, PublisherRecommendation, PublisherConfigurationOverride, PublisherRequirements, PublisherRequirementMessages, PublisherDeliveryState } from "../planning/configuration.js";

export { PUBLISHER_CHANNELS } from "../planning/channel-ids.js";
export type { PublisherChannelId } from "../planning/channel-ids.js";
export { projectRouteRegistry, routeServerLoader, registeredRoutesForChannel, registeredRouteBrandLink, routeRegistryDigest, routeCompositionDigest, registeredRouteFrameFinding } from "./route-registry.js";
export type { RouteSourceExport, RouteRegistration, RouteRegistry, RouteRegistryFinding, RegisteredRouteRow, RouteRegistryProjection } from "./route-registry.js";
export type { InstanceBinding, FlowInstanceBinding, CanvasInstanceBinding, InstanceBindingBase, InstanceSectionRef, SectionFill, InstanceRegistries, ConsumerInstanceLibrary, ConsumerInstanceFill, LayoutRendererSource } from "./instance-binding.js";
export { instanceBodyFill, instanceBodyFindings } from "./instance-body.js";

export { deriveRouteRuntimeBinding } from "./route-runtime.js";
export type { RouteRuntimeBindingResult } from "./route-runtime.js";

export { deriveRegisteredRouteLifecycle } from "./route-lifecycle.js";
export type { RegisteredRouteLifecycleEvidence, RegisteredRouteLifecycleResult, RegisteredRouteNodeCurrentContext } from "./route-lifecycle.js";
export type { RegisteredRouteSourceEvidence } from "./route-source-evidence.js";
export { registeredRouteServerData } from "./route-server-data.js";
export type { RegisteredRouteSerializable, RegisteredRouteServerData } from "./route-server-data.js";
