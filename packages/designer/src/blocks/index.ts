/**
 * @clossys/designer/blocks — the second rung of a three-layer component
 * reusable ladder (atoms → blocks). A block owns
 * the internal layout of MULTIPLE NAMED REGIONS — `PageHeader` (title /
 * description / actions / breadcrumb), `EmptyState` (icon / title /
 * description / action). See this package's README, "Placement rules",
 * for the block/atom test this ladder is built on. Blocks may import from
 * `../atoms/`; the reverse is a layering violation, and `ladder.test.ts`
 * enforces that structurally rather than by convention.
 *
 * A block never reaches outside this package for data or routing — it
 * takes what it needs through props and slots, same as an atom.
 */

import { version as reactVersion } from "react";
import reactAriaComponentsPackageJson from "react-aria-components/package.json" with { type: "json" };
import { assertPeerVersion } from "../internal/peer-version.js";
import { REACT_ARIA_COMPONENTS_DECLARED_RANGE, REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/**
 * `react` and `react-aria-components` are two of this package's optional
 * peers — see `atoms/index.ts`'s own, longer version of this comment for
 * the full #182 rationale and why each is read the way it is (a pure
 * export for `react`, a static JSON import of `react-aria-components`'s
 * own `package.json` for the other, neither touching `node:fs`). This
 * barrel needs its own guard call, independent of `atoms/index.ts`'s:
 * `Toolbar.tsx` and `DataTable.tsx` import `react-aria-components`
 * directly, and a consumer who imports only `@clossys/designer/blocks`
 * (never `@clossys/designer/atoms`) would otherwise get no signal at
 * all.
 */
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });
assertPeerVersion({
  peer: "react-aria-components",
  declaredRange: REACT_ARIA_COMPONENTS_DECLARED_RANGE,
  foundVersion: reactAriaComponentsPackageJson.version,
});

export { SECTION_GROUND_CLASSES } from "./section-ground.js";
export type { SectionGround, SectionGroundClasses, SectionStatusTone } from "./section-ground.js";

export { PageHeader } from "./PageHeader.js";
export type { PageHeaderProps } from "./PageHeader.js";

export { AccountMenu } from "./AccountMenu.js";
export type { AccountMenuProps, AccountMenuActor, AccountMenuEntry, AccountMenuCommand, AccountMenuLink, AccountMenuAction, AccountMenuPreference, AccountMenuSection } from "./account-menu-types.js";

export { EmptyState } from "./EmptyState.js";
export type { EmptyStateProps } from "./EmptyState.js";

export { DataTable } from "./DataTable.js";
export type { DataTableProps, DataTableColumn, DataTableSelectionMode } from "./DataTable.js";

export { DetailView } from "./DetailView.js";
export type { DetailViewProps, DetailViewField } from "./DetailView.js";

export { Pagination } from "./Pagination.js";
export type { PaginationProps } from "./Pagination.js";

export { Stat } from "./Stat.js";
export type { StatProps, StatTrend } from "./Stat.js";

export { Form } from "./Form.js";
export type { FormProps, FormError, FormValidationBinding } from "./Form.js";

export { useFormValidation } from "./useFormValidation.js";
export type {
  UseFormValidationOptions,
  FormValidation,
  FieldValidator,
  FormFieldName,
  FormStringFieldName,
  FormFieldProps,
  FormNativeInputProps,
  FormSubmitButtonProps,
} from "./useFormValidation.js";

export { FieldGroup } from "./FieldGroup.js";
export type { FieldGroupProps, FieldGroupLayout } from "./FieldGroup.js";

export { ConfirmDialog } from "./ConfirmDialog.js";
export type { ConfirmDialogProps, ConfirmDialogTone } from "./ConfirmDialog.js";

export { Toolbar } from "./Toolbar.js";
export type { ToolbarProps } from "./Toolbar.js";

export { NavGrid } from "./NavGrid.js";
export type { NavGridProps, NavGridItem } from "./NavGrid.js";


export { SectionHeader } from "./SectionHeader.js";
export type { SectionHeaderProps, SectionHeaderLevel } from "./SectionHeader.js";

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

export { Faq } from "./Faq.js";
export type { FaqProps, FaqItem, FaqHeadingLevel } from "./Faq.js";

export { PricingTable } from "./PricingTable.js";
export type { PricingTableProps, PricingTier, PricingTableHeadingLevel } from "./PricingTable.js";

export { Testimonial } from "./Testimonial.js";
export type { TestimonialProps } from "./Testimonial.js";

export { ArticleBody } from "./ArticleBody.js";
export type { ArticleBodyProps } from "./ArticleBody.js";

export { SectionFrame } from "./SectionFrame.js";
export type { SectionFrameProps, SectionMeasure } from "./SectionFrame.js";

export { ConsentBanner } from "./ConsentBanner.js";
export type { ConsentBannerProps } from "./ConsentBanner.js";
export { Panel } from "./Panel.js";
export type { PanelProps } from "./Panel.js";
export { Drawer } from "./Drawer.js";
export type { DrawerProps } from "./Drawer.js";
export { ResizablePane } from "./ResizablePane.js";
export type { ResizablePaneProps } from "./ResizablePane.js";
export { APP_FRAME_MATERIALS } from "./app-frame-materials.js";
export { CommandMenu, useCommandMenuShortcut } from "./CommandMenu.js";
export type { CommandMenuProps, CommandMenuItem, CommandMenuGroup, CommandMenuShortcutOptions } from "./command-menu-types.js";
export { AppNavigation } from "./AppNavigation.js";
export type { AppNavigationProps } from "./AppNavigation.js";
export { validateAppNavigationTree, getAppNavigationAncestry, getAppNavigationBreadcrumbs } from "./app-navigation-tree.js";
export type { AppNavigationNode, AppNavigationLeaf, AppNavigationDestination, AppNavigationTarget, AppNavigationBreadcrumb } from "./app-navigation-tree.js";
export { FlowCanvas } from "./FlowCanvas.js";
export type { FlowCanvasProps } from "./FlowCanvas.js";
export { layoutFlowCanvas, FLOW_CANVAS_ORIENTATIONS, FLOW_CANVAS_NODE_LIMIT, FLOW_CANVAS_EDGE_LIMIT } from "./flow-canvas-layout.js";
export type { FlowCanvasNode, FlowCanvasEdge, FlowCanvasOrientation, FlowCanvasLayout, FlowCanvasLayoutNode, FlowCanvasLayoutEdge, FlowCanvasLayoutOptions } from "./flow-canvas-layout.js";

export { RecordLedger } from "./RecordLedger.js";
export type { RecordLedgerProps, LedgerRowData, LedgerGroupData } from "./RecordLedger.js";

export { AnatomyCallouts } from "./AnatomyCallouts.js";
export type { AnatomyCalloutsProps, AnatomyCalloutsMarker } from "./AnatomyCallouts.js";

export { Scene, layoutScene, sceneRelationText } from "./scene/index.js";
export type { SceneProps, SceneInput, SceneConverge, SceneEvidenceTrail, SceneApprovalChain, SceneDisorder, SceneFormat, SceneDocument, SceneRow, SceneStatus, ScenePerson, SceneFinding, ScenePoint, ScenePart, SceneWire, SceneTerminal, SceneTag, SceneNode, ScenePersonLayout, SceneLayout } from "./scene/index.js";

export { Item } from "./items/Item.js";
export { Tree } from "./tree/Tree.js";
export type { TreeProps, TreeNodeData } from "./tree/Tree.js";
export { Items } from "./items/Items.js";
export type { ItemData, ItemFigureData, ItemStatusData, ItemProps, ItemBadge, ItemSize, ItemTreatment, ItemSpan, ItemsProps, ItemsArrangement, ItemsColumns, ItemsScale, ItemsGroup, ItemsLane } from "./items/types.js";
