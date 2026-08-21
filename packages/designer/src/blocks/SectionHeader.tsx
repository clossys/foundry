import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";

export type SectionHeaderLevel = 2 | 3 | 4 | 5 | 6;

type HeadingTag = `h${SectionHeaderLevel}`;

export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Small label above the title ("BETA", "Step 2 of 4", a category name). */
  eyebrow?: ReactNode;
  /** The section's own name. The only required prop. */
  title: ReactNode;
  /** A line of supporting copy under the title. */
  description?: ReactNode;
  /**
   * Slot for the section's own actions — typically one or more `Button`
   * atoms. Rendered at the trailing edge of the title row.
   */
  actions?: ReactNode;
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
  className?: string;
  style?: CSSProperties;
}

/**
 * A heading for a section WITHIN a page — as opposed to `PageHeader`,
 * which announces the page itself. Up to four regions that differ in kind
 * (an optional eyebrow, the title, an optional description, an optional
 * actions slot), and — unlike `PageHeader`, which appears once per page —
 * a single page routinely holds several `SectionHeader`s (one per section
 * of a long settings page, one per card in a dashboard). That "can one
 * page hold two of them?" difference (this package's README, "Placement
 * rules", test 3) is what makes `SectionHeader` its own block rather than
 * a `variant`/`mode` on `PageHeader`: the two are never interchangeable —
 * a page has exactly one `PageHeader` and any number of `SectionHeader`s —
 * so collapsing them into one component with a prop for "which kind" would
 * be exactly the structural-difference-through-a-mode-prop failure the
 * README's variant rule warns against. This file shares no code with
 * `PageHeader.tsx` — the visual rhyme between the two (a title/description
 * column beside an actions slot) is coincidental resemblance, not a
 * factored-out implementation either would break if the other changed.
 *
 * Renders a plain `<div>`, not a `<header>` the way `PageHeader` does:
 * `PageHeader` is a page-level singleton, where `<header>` correctly
 * registers as the page's one `banner` landmark (or a scoped header, if
 * nested inside `<main>`/`<article>`/`<section>`). `SectionHeader` is
 * neither — it's repeatable, and rendering it as a bare top-level
 * `<header>` (i.e., one NOT already nested inside its own `<section>`)
 * would register a SECOND `banner` landmark on the page, which isn't valid
 * document structure. The real navigational structure a `SectionHeader`
 * needs to provide comes from its heading element (`level`, above) and
 * screen readers' own heading-by-heading navigation, not from a landmark
 * role — so a plain `<div>` carries no risk and no missing capability.
 *
 * Deliberately has no other `variant`/`mode` prop, the same as
 * `PageHeader`: a consuming page that needs a structurally different
 * section header composes that directly with slots (`eyebrow`, `actions`)
 * rather than asking this component to grow a new mode for it.
 */
export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  level = 2,
  className,
  style,
  ...rest
}: SectionHeaderProps) {
  const HeadingTag = `h${level}` as HeadingTag;

  return (
    <div {...rest} className={cx("flex flex-col gap-xs", className)} style={style}>
      {eyebrow ? (
        <p className="text-caption uppercase tracking-label text-ink-muted">{eyebrow}</p>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex flex-col gap-xs">
          <HeadingTag className="text-h3 font-display text-ink-primary">{title}</HeadingTag>
          {description ? (
            <p className="text-body text-ink-secondary">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-sm">{actions}</div> : null}
      </div>
    </div>
  );
}
