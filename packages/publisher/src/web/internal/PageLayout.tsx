import { Children } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Card } from "@clossys/designer/atoms/server";

/**
 * The classes of a page layout's column. A chrome-free view puts them on its
 * content root; the deprecated legacy page puts them on its own `<main>`.
 */
export const PAGE_COLUMN_CLASSES = "mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl";

/**
 * The column's measure, from a design token with no raw-length fallback: the
 * form column for a sign-in page, the prose column for a capture or document
 * page.
 */
export function pageColumnStyle(measure: "form" | "prose", style?: CSSProperties): CSSProperties {
  return { maxWidth: measure === "form" ? "var(--ui-width-form-max, none)" : "var(--ui-width-prose-max, none)", ...style };
}

/** True when a slot has something to render: `null`, `undefined`, booleans, `""` and an empty list do not. */
function hasContent(node: ReactNode): boolean {
  return Children.toArray(node).some((child) => child !== "");
}

export interface PageLayoutHeaderProps {
  /** The page's one `<h1>`. */
  title: ReactNode;
  /** A line of supporting copy under the title. */
  subtitle?: ReactNode;
}

/**
 * The title block of a standard page: the one `<h1>`, centered, with an
 * optional subtitle under it. `PageLayout` renders it above its card, and the
 * card-free layout renders the same component, so both share the header and
 * its spacing. It ships no copy.
 */
export function PageLayoutHeader({ title, subtitle }: PageLayoutHeaderProps) {
  return (
    <header className="flex flex-col items-center gap-xs text-center">
      <h1 className="text-h1 font-display text-ink-primary">{title}</h1>
      {subtitle ? <p className="text-body text-ink-secondary">{subtitle}</p> : null}
    </header>
  );
}

export interface PageLayoutProps extends PageLayoutHeaderProps {
  /** The body, rendered inside the card and start-aligned for reading. */
  children: ReactNode;
  /**
   * A footnote-like line under the card, usually one alternative link. The
   * element is absent from the markup when this is empty.
   */
  notes?: ReactNode;
  /** When given, the card sits in a region with this accessible name. */
  cardLabel?: string;
}

/**
 * The layout shared by `CaptureView`, `DocumentView` and `AuthView`: the
 * header (title and subtitle), the body card and the optional notes, centered
 * in that order. It returns the three slots only, for the view to place in its
 * own column, and renders no header landmark of its own beyond the title block,
 * no footer and no `<main>`: the page frame owns those. Every string is a prop.
 */
export function PageLayout({ title, subtitle, children, notes, cardLabel }: PageLayoutProps) {
  const card = <Card className="flex flex-col gap-lg text-start">{children}</Card>;
  return (
    <>
      <PageLayoutHeader title={title} subtitle={subtitle} />
      {cardLabel === undefined ? card : <section aria-label={cardLabel}>{card}</section>}
      {hasContent(notes) ? <div className="flex flex-col items-center gap-xs text-center text-body-s text-ink-secondary">{notes}</div> : null}
    </>
  );
}
