/**
 * @vespeneventures/ui/blocks — the second rung of a three-layer component
 * ladder (atoms → blocks → views; `views` isn't built yet). A block owns
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

export { PageHeader } from "./PageHeader.js";
export type { PageHeaderProps } from "./PageHeader.js";

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
