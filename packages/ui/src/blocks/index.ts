/**
 * @vespeneventures/ui/blocks — the second rung of a three-layer component
 * ladder (atoms → blocks → views; `views` isn't built yet). A block
 * composes one or more atoms (and/or layout) into something with a real
 * job in a page — `PageHeader`, `Breadcrumb`, `EmptyState`. Blocks may
 * import from `../atoms/`; the reverse is a layering violation, and
 * `ladder.test.ts` enforces that structurally rather than by convention.
 *
 * A block never reaches outside this package for data or routing — it
 * takes what it needs through props and slots, same as an atom.
 */

export { PageHeader } from "./PageHeader.js";
export type { PageHeaderProps } from "./PageHeader.js";

export { Breadcrumb } from "./Breadcrumb.js";
export type { BreadcrumbProps, BreadcrumbItemProps } from "./Breadcrumb.js";

export { EmptyState } from "./EmptyState.js";
export type { EmptyStateProps } from "./EmptyState.js";
