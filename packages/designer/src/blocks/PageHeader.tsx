import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { SectionHeader } from "./SectionHeader.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.page-header", "foundry/sections.page-header");

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** The page's own name. The only required prop. */
  title: ReactNode;
  /** A line of supporting copy under the title. */
  description?: ReactNode;
  /**
   * Slot for the page's primary actions — typically one or more `Button`
   * components. Rendered at the trailing edge of the title row.
   */
  actions?: ReactNode;
  /**
   * Slot for a `Breadcrumb` component (or any `ReactNode`), rendered above the
   * title. Not required — a top-level page has nowhere to link back to.
   */
  breadcrumb?: ReactNode;
}

/**
 * A page's top-of-content banner: an optional breadcrumb trail, a title,
 * an optional description, and an optional row of actions. Composes no
 * behavior of its own — everything interactive it renders (a `Breadcrumb`,
 * `Button`s) is passed in as a slot, not configured through a prop.
 *
 * Deliberately has no `variant`/`mode` prop. A consuming page that needs a
 * structurally different header — no description, an extra badge next to
 * the title, actions that wrap onto a second row — composes that directly
 * with slots rather than asking this component to grow a new mode for it.
 * See this package's README for why: a shared component that tried to
 * absorb structural differences through a mode prop has failed twice
 * before in the history behind this package.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
  ...rest
}: PageHeaderProps) {
  return (
    // The stamp follows the rest spread so source fixtures that anchor on the header's first spread still match.
    <header {...rest} {...SECTION_STAMP} className={cx("flex flex-col gap-md", className)}>
      {breadcrumb}
      <SectionHeader
        level={1}
        title={title}
        titleClassName="text-h1"
        description={description}
        actions={actions}
      />
    </header>
  );
}
