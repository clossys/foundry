import { SectionHeader } from "./SectionHeader.js";
import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.empty-state", "foundry/sections.empty-state");

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Slot for an icon or illustration, rendered above the title. */
  icon?: ReactNode;
  /** The only required prop. Rendered as a heading. */
  title: ReactNode;
  /** A line of supporting copy under the title. */
  description?: ReactNode;
  /**
   * Slot for the recovery action — typically a `Button` component ("Create your
   * first prompt", "Clear filters"). Not every empty state has one (a
   * genuinely empty inbox has nothing to do about it), so it's optional.
   */
  action?: ReactNode;
}

/**
 * A placeholder shown in place of a list, table, or feed that currently has
 * nothing in it — the zero-item state for views like `/evals`,
 * `/experiments`, `/prompts`, `/inbox`. Composes no behavior of its own;
 * `icon` and `action` are slots, not configuration for a fixed set of
 * built-in icons/actions.
 *
 * `title` renders as a heading (`<h2>`) so the empty state announces itself
 * to assistive tech the same way any other section heading would, and so a
 * page can be scanned by heading alone even when every list item that would
 * normally carry structure is, by definition, absent.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <SemanticContent as="div"
      {...SECTION_STAMP} {...rest}
      className={cx(
        "flex flex-col justify-center gap-sm p-2xl text-center",
        className,
      )}
    >
      {icon ? <SemanticContent as="div" className="text-ink-muted">{icon}</SemanticContent> : null}
      <SectionHeader density="standard" align="center" level={2} title={title} description={description} />
      {action ? <SemanticContent as="div" className="mt-sm">{action}</SemanticContent> : null}
    </SemanticContent>
  );
}
