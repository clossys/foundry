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

export { Form } from "./Form.js";
export type { FormProps, FormError } from "./Form.js";

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
export type { HeroProps, HeroHeadingLevel } from "./Hero.js";

export { FeatureGrid } from "./FeatureGrid.js";
export type { FeatureGridProps, FeatureGridItem, FeatureGridHeadingLevel } from "./FeatureGrid.js";

export { OrderedStepSequence } from "./OrderedStepSequence.js";
export type {
  OrderedStepSequenceProps,
  OrderedStepSequenceItem,
  OrderedStepSequenceHeadingLevel,
  OrderedStepSequenceGround,
} from "./OrderedStepSequence.js";

export { StatusList } from "./StatusList.js";
export type { StatusListProps, StatusListGroup, StatusListItem, StatusListLabels, StatusListState, StatusListHeadingLevel } from "./StatusList.js";

export { Faq } from "./Faq.js";
export type { FaqProps, FaqItem, FaqHeadingLevel } from "./Faq.js";

export { PricingTable } from "./PricingTable.js";
export type { PricingTableProps, PricingTier, PricingTableHeadingLevel } from "./PricingTable.js";

export { Testimonial } from "./Testimonial.js";
export type { TestimonialProps } from "./Testimonial.js";

export { ArticleBody } from "./ArticleBody.js";
export type { ArticleBodyProps } from "./ArticleBody.js";
