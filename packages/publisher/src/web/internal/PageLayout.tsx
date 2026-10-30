import { Children } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Card, mergeUiClasses } from "@clossys/designer/components/server";
import { SectionFrame } from "@clossys/designer/blocks/server";

/**
 * The classes of the deprecated legacy page's `<main>`: the page column, with
 * its own gutter and slot rhythm, for a view that draws its own chrome.
 */
export const PAGE_COLUMN_CLASSES = "mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl";

/**
 * The page column as a Section (`sections.band`): measured, centred, filling
 * the frame's `<main>`, with the page rhythm above and below. The band's own
 * content column owns the gutter and the gap between the slots.
 */
const PAGE_SECTION_CLASSES = "mx-auto flex w-full flex-1 flex-col py-2xl";

/** The notes line under either layout's body: centred, small, secondary ink. */
const NOTES_CLASSES = "flex flex-col items-center gap-xs text-center text-body-s text-ink-secondary";

/**
 * The column's measure, from a design token with no raw-length fallback: the
 * form column for a sign-in page, the prose column for a capture or document
 * page.
 */
function pageColumnStyle(measure: "form" | "prose", style?: CSSProperties): CSSProperties {
  return { maxWidth: measure === "form" ? "var(--ui-width-form-max, none)" : "var(--ui-width-prose-max, none)", ...style };
}

export interface PageColumnProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The column's measure: the form column (sign-in, status) or the prose column (capture, document). */
  measure: "form" | "prose";
  /** Centre the content vertically in the frame's `<main>`: the card-free layout. */
  centered?: boolean;
  children: ReactNode;
}

/**
 * The shared page column of every chrome-free front-door view, and that view's
 * one placement in `SiteFrame`'s content slot. It is a Section, Designer's
 * `SectionFrame` (`sections.band`), so nothing the view draws sits in the
 * frame's `<main>` outside a Section (E5, WL1). The view's root attributes,
 * `className` and `style` land on the Section, which is the column.
 */
export function PageColumn({ measure, centered = false, className, style, children, ...rest }: PageColumnProps) {
  return (
    <SectionFrame
      {...rest}
      measure="prose"
      className={mergeUiClasses(PAGE_SECTION_CLASSES, centered ? "justify-center" : undefined, className)}
      style={pageColumnStyle(measure, style)}
    >
      {children}
    </SectionFrame>
  );
}

/** True when a slot has something to render: `null`, `undefined`, booleans, `""` and an empty list do not. */
export function hasContent(node: ReactNode): boolean {
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
export function PageLayoutHeader({ title, subtitle, alignment }: PageLayoutHeaderProps & { alignment?: "start" }) {
  return (
    <div className={alignment === "start" ? "flex flex-col items-start gap-xs text-start" : "flex flex-col items-center gap-xs text-center"}>
      <h1 className="text-h1 font-display text-ink-primary">{title}</h1>
      {subtitle ? <p className="text-body text-ink-secondary">{subtitle}</p> : null}
    </div>
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
  /** Internal opt-in content plate. Omitted keeps the existing raised card. */
  surface?: "plate";
  /** Internal start alignment. Omitted keeps the existing centered header and notes. */
  alignment?: "start";
}

/**
 * The layout shared by `CaptureView`, `DocumentView`, `AuthView` and the framed
 * `LegalView`: the header (title and subtitle), the body card and the optional
 * notes, centered in that order. It returns the three slots only, for the view to place in its
 * `PageColumn` (or the legacy page's `<main>`), and renders no header, footer or `<main>`
 * landmark: the page frame owns those. Every string is a prop.
 */
export function PageLayout({ title, subtitle, children, notes, cardLabel, surface, alignment }: PageLayoutProps) {
  const card = surface === "plate"
    ? <Card variant="plate" className="border border-line-panel flex flex-col gap-lg text-start">{children}</Card>
    : <Card className="flex flex-col gap-lg text-start">{children}</Card>;
  return (
    <>
      <PageLayoutHeader title={title} subtitle={subtitle} alignment={alignment} />
      {cardLabel === undefined ? card : <section aria-label={cardLabel}>{card}</section>}
      {hasContent(notes) ? <div className={alignment === "start" ? "flex flex-col items-start gap-xs text-start text-body-s text-ink-secondary" : NOTES_CLASSES}>{notes}</div> : null}
    </>
  );
}

export interface CardlessPageLayoutProps extends PageLayoutHeaderProps {
  /**
   * The one primary call to action, on the page background with no card
   * around it: usually one link or button. The element is absent from the
   * markup when this is empty.
   */
  action?: ReactNode;
  /**
   * A footnote-like line under the action, for quiet secondary links. The
   * element is absent from the markup when this is empty.
   */
  notes?: ReactNode;
}

/**
 * The card-free layout used by `StatusView`: the same
 * header as `PageLayout` (title and subtitle), then one primary action and the
 * optional notes, centered, with no card. It returns the slots only, for the
 * view to place in its centred `PageColumn`, and renders no header, footer or `<main>`
 * landmark: the page frame owns those. Every string is a prop.
 */
export function CardlessPageLayout({ title, subtitle, action, notes }: CardlessPageLayoutProps) {
  return (
    <>
      <PageLayoutHeader title={title} subtitle={subtitle} />
      {hasContent(action) ? <div className="flex flex-col items-center gap-sm">{action}</div> : null}
      {hasContent(notes) ? <div className={NOTES_CLASSES}>{notes}</div> : null}
    </>
  );
}
