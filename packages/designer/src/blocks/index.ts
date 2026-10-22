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

export { parseDataTableViewModel, serializeDataTableViewModel, DataTableViewModelError } from "./data-table/view-model.js";
export type { DataTableMessages } from "./data-table/messages.js";
export type { DataTableViewModel, DataTableViewModelV1, DataTableMode, DataTableDensity, DataTableSortRule } from "./data-table/view-model.js";

export { DataTable } from "./DataTable.js";
export type { DataTableProps, DataTableColumn, DataTableSelectionMode } from "./DataTable.js";

export { filterRows, groupRows, pivotRows, aggregate, parseTableModel, serializeTableModel, TableModelError, tableFilterPredicate, pruneFilterColumn, TABLE_FILTER_CONFORMANCE } from "./table-model/index.js";
export type { TableValue, TableColumnKind, TableColumn, TableCollation, TableFilter, TableFilterGroup, TableFilterNode, TableDimension, TableMeasure, TablePivot, TableModel, TableFacet, TableFilterResult, TableAggregateValue, TableAggregates, TableGroup, TablePivotAxis, TablePivotCell, TablePivotResult, TableModelErrorCode } from "./table-model/index.js";

export { DetailView } from "./DetailView.js";
export type { DetailViewProps, DetailViewField } from "./DetailView.js";

export { Pagination } from "./Pagination.js";
export type { PaginationProps } from "./Pagination.js";

export { UsageMeter } from "./UsageMeter.js";
export type { UsageMeterProps, UsageMeterThreshold } from "./UsageMeter.js";

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
export type { PricingTableProps, PricingTier, PricingTableHeadingLevel, PricingTierPrice, PricingCellData, PricingComparison, PricingComparisonGroup, PricingComparisonRow } from "./PricingTable.js";

export { Testimonial } from "./Testimonial.js";
export type { TestimonialProps } from "./Testimonial.js";

export { TableOfContents } from "./TableOfContents.js";
export type { TableOfContentsProps, TableOfContentsItem } from "./TableOfContents.js";

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
export { PageBar } from "./PageBar.js";
export type { PageBarProps, PageBarPage, PageBarCrumb, PageBarAction, PageBarDestination, PageBarLabels, PageBarWidth } from "./PageBar.js";
export { validateAppNavigationTree, getAppNavigationAncestry, getAppNavigationBreadcrumbs } from "./app-navigation-tree.js";
export type { AppNavigationNode, AppNavigationLeaf, AppNavigationDestination, AppNavigationTarget, AppNavigationBreadcrumb } from "./app-navigation-tree.js";
export { RelationGraph } from "./RelationGraph.js";
export type { RelationGraphProps, RelationGraphNode, RelationGraphEdge } from "./relation-graph-types.js";
export { Explorer } from "./Explorer.js";
export type { ExplorerProps } from "./Explorer.js";
export { indexTree, getTreeAncestry, getTreeBreadcrumbs } from "./tree-model.js";
export type { TreeNode, TreeTarget, TreeBreadcrumb, TreeValidationOptions, TreeIndex } from "./tree-model.js";

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

export { Lockup } from "./Lockup.js";
export type { LockupProps } from "./Lockup.js";
export { GroupedTable } from "./GroupedTable.js";
export type { GroupedTableProps, GroupedTableGroup, GroupedTableColumn } from "./GroupedTable.js";

export { scheduleProject, projectRollups, boardColumns, timelineLayout, serializeProject, parseProject, ProjectModelError } from "./project-model/index.js";
export type { ProjectDay, TaskDependency, Task, Calendar, ProjectModelErrorCode, ProjectModel, ScheduledTask, ProjectConflict, ProjectSchedule, ProjectRollup, BoardOptions, BoardColumn, TimelineZoom, TimelineOptions, TimelinePoint, TimelineRow, TimelineConnector, TimelineLayout } from "./project-model/index.js";

export { GraphValidationError, validateGraph, neighbors, subgraph, degrees, components, shortestPath, groupByKind, radialLayout, forceLayout, edgeRoutingHints } from "./graph-model/index.js";
export type { GraphNode, GraphEdge, GraphInput, GraphModelEdge, GraphModel, GraphErrorCode, GraphNeighborOptions, GraphSubgraphOptions, GraphDegree, GraphKindGroup, GraphPosition, GraphRadialOptions, GraphForceOptions, GraphEdgeRoutingHint } from "./graph-model/index.js";

export { CatalogWorkspace } from "./CatalogWorkspace.js";
export type { CatalogWorkspaceProps, CatalogWorkspaceItem, CatalogWorkspaceSize } from "./CatalogWorkspace.js";

export { Chat } from "./chat/Chat.js";
export type { ChatProps, ChatMessage, ChatActions, ChatLabels } from "./chat/types.js";

export { AccessMatrix } from "./AccessMatrix.js";
export type { AccessCellValue, AccessRole, AccessPermission, AccessGroup, AccessMatrixValue, AccessMatrixChange, AccessMatrixLabels, AccessMatrixProps } from "./AccessMatrix.js";
export { ColumnMapper } from "./ColumnMapper.js";
export type { ColumnMapperTarget, ColumnMapperSource, ColumnMapping, ColumnMapperIssue, ColumnMapperLabels, ColumnMapperProps } from "./ColumnMapper.js";
export { NewsletterBand } from "./NewsletterBand.js";
export type { NewsletterBandProps, NewsletterStatus } from "./NewsletterBand.js";
export { ResourceList } from "./ResourceList.js";
export type { ResourceListProps, ResourceListItem, ResourceListAction } from "./ResourceList.js";
