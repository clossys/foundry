import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../selected-components/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.section-header", "foundry/sections.section-header");

export type SectionHeaderLevel = 2 | 3 | 4 | 5 | 6;

type HeadingTag = `h${SectionHeaderLevel}`;

export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Small label above the title ("BETA", "Step 2 of 4", a category name). */
  eyebrow?: ReactNode;
  /** The section's own name. Explicit empty values keep a heading. */
  title?: ReactNode;
  /** A line of supporting copy under the title. */
  description?: ReactNode;
  /**
   * Slot for the section's own actions — typically one or more `Button`
   * components. Rendered at the trailing edge of the title row.
   */
  actions?: ReactNode;
  /** Host-resolved stat badges and status summary. */
  stats?: ReactNode;
  /**
   * Which heading element `title` renders as (`<h2>` through `<h6>`) — a
   * real, settable prop rather than a component always fixed to one level.
   * A page's document outline has to stay unbroken (no skipped levels) no
   * matter how deep a `SectionHeader` sits: one directly under a
   * `PageHeader`'s own `<h1>` needs `level={2}` (the default), but a
   * `SectionHeader` for a subsection of THAT section needs `level={3}`, and
   * so on. Getting this wrong — hardcoding one level, or styling a `<div>`
   * to merely LOOK like a heading — is the detail most section-header
   * implementations get wrong; it's invisible to a sighted user and breaks
   * heading-by-heading screen-reader navigation for everyone else.
   * @default 2
   */
  level?: SectionHeaderLevel;
  /** Visual scale, independent of heading rank. @default "compact" */
  density?: "compact" | "standard" | "display";
  align?: "start" | "center";
  /** Foreground inks only; paints no surface. */
  ground?: SectionGround;
  /** Additional classes on the real heading, merged last. */
  titleClassName?: string;
  className?: string;
  style?: CSSProperties;
}

/** A repeatable section title region; the div introduces no banner landmark. */
export function SectionHeader(props: SectionHeaderProps) {
  const {
    eyebrow, title, description, actions, stats, level = 2, density = "compact",
    align = "start", ground = "base", titleClassName, className, style, ...rest
  } = props;
  const HeadingTag = `h${level}` as HeadingTag;
  const hasTitle = Object.hasOwn(props, "title");
  const colors = SECTION_GROUND_CLASSES[ground];
  const centered = align === "center";
  const display = density === "display";
  const hasCopy = Boolean(eyebrow) || hasTitle || Boolean(description);
  const titleNode = hasTitle ? (
    <HeadingTag className={cx(
      display ? "text-display-m tablet:text-display-l font-display leading-display text-balance"
        : density === "standard" ? "text-h2 font-display" : "text-h3 font-display",
      colors.primary, display && eyebrow ? "mt-sm" : undefined, titleClassName,
    )}>{title}</HeadingTag>
  ) : null;
  const eyebrowNode = eyebrow ? (
    <p className={cx(
      display ? "text-body-s font-medium uppercase tracking-label" : "text-caption uppercase tracking-label",
      display ? ground === "inverse" ? "text-accent-on-inverse" : "text-accent-text" : colors.muted,
    )}>{eyebrow}</p>
  ) : null;
  const descriptionNode = description ? (
    <p className={cx(display ? "text-body-l text-pretty" : "text-body", colors.secondary,
      display && (eyebrow || hasTitle) ? "mt-2xl" : undefined)}>{description}</p>
  ) : null;
  const actionsNode = actions ? (
    <div className={cx("flex items-center gap-sm", centered ? "justify-center" : undefined,
      display && hasCopy ? "mt-3xl" : undefined,
      !display && !centered && !hasTitle && !description ? "ms-auto" : undefined)}>{actions}</div>
  ) : null;
  return (
    <div {...SECTION_STAMP} {...rest} className={cx(display ? "flex flex-col" : "flex flex-col gap-xs", centered ? "items-center text-center" : undefined, className)} style={style}>
      {eyebrowNode}
      {stats ? <div className="flex flex-wrap items-center gap-sm">{stats}</div> : null}
      {display || (density === "standard" && (!actions || centered)) ? (
        <>{titleNode}{descriptionNode}{actionsNode}</>
      ) : (
        <div className={cx("flex flex-wrap items-start justify-between gap-md", centered ? "flex-col items-center" : undefined)}>
          {hasTitle || description ? <div className="flex flex-col gap-xs">{titleNode}{descriptionNode}</div> : null}
          {actionsNode}
        </div>
      )}
    </div>
  );
}
