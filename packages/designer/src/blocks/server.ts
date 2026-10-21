/**
 * @clossys/designer/blocks/server — the server-safe subset of
 * `@clossys/designer/blocks`. See `atoms/server.ts`'s own header for the
 * full #375 rationale this file shares: `blocks/index.ts` re-exports
 * every block eagerly from one module, so the interactive minority
 * (`DataTable`, `Form`, `ConfirmDialog`, `Toolbar`, `NavGrid`,
 * `Pagination` and the client `Testimonial`) drags the whole barrel down under React's
 * `react-server` condition even though eleven individual blocks resolve
 * cleanly on their own.
 *
 * MEMBERSHIP IS EMPIRICAL — confirmed by resolving each member's own
 * compiled file (`dist/blocks/<Name>.js`, never the barrel) under
 * `node --conditions=react-server`. `PricingTable` is included here even
 * though an earlier audit (see issue #375's own body) didn't list it as
 * safe: it imports only `Badge` and `Card` (both server-safe atoms) and
 * types from `react`, and the probe confirms it resolves cleanly — the
 * earlier list was a hypothesis, re-verified here, not a source of truth.
 * See `src/render-environment.ts` for the recorded verdict and
 * `render-environment.test.ts` for the negative control proving
 * `blocks/index.ts` still fails the identical probe.
 *
 * ADDITIVE ONLY: every name below already ships from `blocks/index.ts`.
 * No wildcard subpath, no per-file deep export — see `atoms/server.ts`'s
 * header for why.
 */

import { version as reactVersion } from "react";
import { assertPeerVersion } from "../internal/peer-version.js";
import { REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/**
 * `react` guard only — see `atoms/server.ts`'s own header for why
 * `react-aria-components` is deliberately NOT guarded from this file:
 * none of the members below import it (confirmed by grep against each
 * one's own source), and guarding it here would make that peer
 * non-optional for every consumer of this narrower subpath.
 */
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export { SECTION_GROUND_CLASSES } from "./section-ground.js";
export type { SectionGround, SectionGroundClasses, SectionStatusTone } from "./section-ground.js";

export { ArticleBody } from "./ArticleBody.js";
export type { ArticleBodyProps } from "./ArticleBody.js";

export { DetailView } from "./DetailView.js";
export type { DetailViewProps, DetailViewField } from "./DetailView.js";

export { EmptyState } from "./EmptyState.js";
export type { EmptyStateProps } from "./EmptyState.js";

export { FeatureGrid } from "./FeatureGrid.js";
export type {
  FeatureGridProps,
  FeatureGridItem,
  FeatureGridHeadingLevel,
} from "./FeatureGrid.js";
export { Matrix } from "./Matrix.js";
export type { MatrixProps, MatrixGridProps, MatrixQuadrantProps, MatrixCellData, MatrixSide, MatrixHeadingLevel } from "./Matrix.js";
export { Specimen } from "./specimen/Specimen.js";
export type { SpecimenProps, SpecimenArrangement } from "./specimen/Specimen.js";
export { SpecimenPanel } from "./specimen/SpecimenPanel.js";
export type {
  SpecimenPanelProps,
  SpecimenPanelContent,
  SpecimenPanelItem,
  SpecimenFooter,
  SpecimenAssignee,
} from "./specimen/SpecimenPanel.js";
export type {
  SpecimenTone,
  SpecimenStatus,
  SpecimenPart,
  SpecimenPartType,
  SpecimenFieldsPart,
  SpecimenField,
  SpecimenStatusRowsPart,
  SpecimenStatusRow,
  SpecimenMeterPart,
  SpecimenTablePart,
  SpecimenTableColumn,
  SpecimenTableRow,
  SpecimenTableCell,
  SpecimenSchedulePart,
  SpecimenScheduleItem,
  SpecimenSharesPart,
  SpecimenShare,
  SpecimenFilesPart,
  SpecimenFile,
} from "./specimen/parts.js";

export { OrderedStepSequence } from "./OrderedStepSequence.js";
export type {
  OrderedStepSequenceProps,
  OrderedStepSequenceItem,
  OrderedStepSequenceHeadingLevel,
  OrderedStepSequenceGround,
} from "./OrderedStepSequence.js";

export { StatusList } from "./StatusList.js";
export type {
  StatusListProps,
  StatusListGroup,
  StatusListItem,
  StatusListReadinessItem,
  StatusListDispositionItem,
  StatusListLabels,
  StatusListState,
  StatusListDisposition,
  StatusListHeadingLevel,
} from "./StatusList.js";

export { Faq } from "./Faq.server.js";
export type { FaqProps, FaqItem, FaqHeadingLevel } from "./Faq.js";

export { FieldGroup } from "./FieldGroup.js";
export type { FieldGroupProps, FieldGroupLayout } from "./FieldGroup.js";

export { Hero } from "./Hero.js";
export type { HeroProps, HeroHeadingLevel, HeroComposition, HeroAlign } from "./Hero.js";

export { ContentSection } from "./ContentSection.js";
export type {
  ContentSectionProps,
  ContentSectionStackedProps,
  ContentSectionSplitProps,
  ContentSectionHeadingLevel,
  ContentSectionAlign,
  ContentSectionLayout,
  ContentSectionMediaSide,
  ContentSectionEmphasis,
} from "./ContentSection.js";
export { SectionIntro } from "./SectionIntro.js";
export type { SectionIntroProps, SectionIntroHeadingLevel, SectionIntroEmphasis, SectionIntroAlign } from "./SectionIntro.js";

export { MediaFigure } from "./MediaFigure.js";
export type { MediaFigureProps, MediaFigureMeasure } from "./MediaFigure.js";

export { MarketingChapter } from "./MarketingChapter.js";
export type { MarketingChapterProps, MarketingChapterHeadingLevel } from "./MarketingChapter.js";

export { PageHeader } from "./PageHeader.js";
export type { PageHeaderProps } from "./PageHeader.js";

export { PricingTable } from "./PricingTable.js";
export type { PricingTableProps, PricingTier, PricingTableHeadingLevel } from "./PricingTable.js";

export { SectionHeader } from "./SectionHeader.js";
export type { SectionHeaderProps, SectionHeaderLevel } from "./SectionHeader.js";

export { SectionFrame } from "./SectionFrame.js";
export type { SectionFrameProps, SectionMeasure } from "./SectionFrame.js";

export { UsageMeter } from "./UsageMeter.js";
export type { UsageMeterProps, UsageMeterThreshold } from "./UsageMeter.js";

export { Stat } from "./Stat.js";
export type { StatProps, StatTrend } from "./Stat.js";

export { Testimonial } from "./Testimonial.server.js";
export type { TestimonialProps } from "./Testimonial.js";

export { RecordLedger } from "./RecordLedger.js";
export type { RecordLedgerProps, LedgerRowData, LedgerGroupData } from "./RecordLedger.js";

export { AnatomyCallouts } from "./AnatomyCallouts.js";
export type { AnatomyCalloutsProps, AnatomyCalloutsMarker } from "./AnatomyCallouts.js";

export { Scene, layoutScene, sceneRelationText } from "./scene/index.js";
export type { SceneProps, SceneInput, SceneConverge, SceneEvidenceTrail, SceneApprovalChain, SceneDisorder, SceneFormat, SceneDocument, SceneRow, SceneStatus, ScenePerson, SceneFinding, ScenePoint, ScenePart, SceneWire, SceneTerminal, SceneTag, SceneNode, ScenePersonLayout, SceneLayout } from "./scene/index.js";

export { Item } from "./items/Item.js";
export { Tree } from "./tree/Tree.js";
export type { TreeProps, TreeNodeData } from "./tree/Tree.js";
export { Items } from "./items/Items.server.js";
export type { ItemData, ItemFigureData, ItemStatusData, ItemProps, ItemBadge, ItemSize, ItemTreatment, ItemSpan, ItemsProps, ItemsArrangement, ItemsColumns, ItemsScale, ItemsGroup, ItemsLane } from "./items/types.js";

export { Lockup } from "./Lockup.js";
export type { LockupProps } from "./Lockup.js";
