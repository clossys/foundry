import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Card } from "../atoms/Card.js";
import { Icon } from "../atoms/Icon.js";
import { cx } from "../atoms/internal/cx.js";
import { ArrowRight } from "../icons/ArrowRight.js";
import { Check } from "../icons/Check.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

/** Which heading element each side's label renders as. */
export type ComparisonHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface ComparisonSide {
  /** Short name for the side ("Today", "With the new process"). Rendered as the side's heading. */
  label: ReactNode;
  /** Optional line under the label. */
  heading?: ReactNode;
  /** One paragraph. Use this or `points`, the same on both sides. */
  description?: ReactNode;
  /** 2 to 4 parallel lines, the same count on both sides. */
  points?: readonly ReactNode[];
  /** Optional visual under the text (typically a one-panel `Specimen`), on both sides or neither. */
  visual?: ReactNode;
}

export interface ComparisonProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** The old way: set on the ground in quieter ink. */
  before: ComparisonSide;
  /** The new way: set on a plate in primary ink. */
  after: ComparisonSide;
  /** Which heading element each side's label uses: one below the section heading. @default 3 */
  headingLevel?: ComparisonHeadingLevel;
  /** The ground the comparison sits on. @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

const HEADING_TAGS = { 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const satisfies Record<ComparisonHeadingLevel, string>;

/** The dash before each "before" point (8px of muted ink), per ground. */
const DASH_CLASSES: Record<SectionGround, string> = {
  base: "block h-px w-sm bg-ink-muted",
  sunken: "block h-px w-sm bg-ink-muted",
  inverse: "block h-px w-sm bg-ink-on-inverse-muted",
};

/** The check before each "after" point, per ground. */
const CHECK_CLASSES: Record<SectionGround, string> = {
  base: "text-accent",
  sunken: "text-accent",
  inverse: "text-accent-on-inverse",
};

function hasNode(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

interface SideBodyProps {
  side: ComparisonSide;
  tone: "before" | "after";
  headingLevel: ComparisonHeadingLevel;
  ground: SectionGround;
}

function SideBody({ side, tone, headingLevel, ground }: SideBodyProps) {
  const HeadingTag = HEADING_TAGS[headingLevel];
  const colors = SECTION_GROUND_CLASSES[ground];
  const after = tone === "after";
  const ink = after ? colors.primary : colors.secondary;

  return (
    <>
      <div className="flex flex-col gap-xs">
        {/* Secondary on both sides: muted ink is only AA-large on a sunken ground or a plate. */}
        <HeadingTag className={cx("text-caption uppercase tracking-label", colors.secondary)}>
          {side.label}
        </HeadingTag>
        {hasNode(side.heading) ? (
          <p className={cx("text-h2 font-display leading-heading text-balance", ink)}>{side.heading}</p>
        ) : null}
      </div>
      {hasNode(side.description) ? <p className={cx("text-body text-pretty", ink)}>{side.description}</p> : null}
      {side.points && side.points.length > 0 ? (
        <ul className="flex flex-col gap-sm">
          {side.points.map((point, index) => (
            // Points are authored, ordered copy with no ids of their own.
            <li key={index} className={cx("flex items-start gap-sm text-body", ink)}>
              <span aria-hidden="true" className="mt-xs flex size-lg shrink-0 items-center justify-center">
                {after ? (
                  <Icon glyph={Check} decorative size="sm" className={CHECK_CLASSES[ground]} />
                ) : (
                  <span className={DASH_CLASSES[ground]} />
                )}
              </span>
              <span className="min-w-0">{point}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {hasNode(side.visual) ? (
        <div data-comparison-visual="" className="w-full min-w-0 pt-md">
          {side.visual}
        </div>
      ) : null}
    </>
  );
}

/** The rows a side's body fills: the label group, then a description, points and a visual when present. */
function sideRows(side: ComparisonSide): number {
  return 1 + (hasNode(side.description) ? 1 : 0) + (side.points && side.points.length > 0 ? 1 : 0) + (hasNode(side.visual) ? 1 : 0);
}

/**
 * Each side spans the shared rows and lays its parts on them (`subgrid`), so
 * label, copy and visual each start on one line across both sides. Static
 * class names per row count, from the breakpoint where the sides go side by
 * side (`tablet`, or `tablet-lg` with visuals).
 */
const SIDE_ROW_CLASSES = {
  plain: {
    1: "tablet:row-span-1 tablet:grid tablet:grid-rows-subgrid",
    2: "tablet:row-span-2 tablet:grid tablet:grid-rows-subgrid",
    3: "tablet:row-span-3 tablet:grid tablet:grid-rows-subgrid",
    4: "tablet:row-span-4 tablet:grid tablet:grid-rows-subgrid",
  },
  visual: {
    1: "tablet-lg:row-span-1 tablet-lg:grid tablet-lg:grid-rows-subgrid",
    2: "tablet-lg:row-span-2 tablet-lg:grid tablet-lg:grid-rows-subgrid",
    3: "tablet-lg:row-span-3 tablet-lg:grid tablet-lg:grid-rows-subgrid",
    4: "tablet-lg:row-span-4 tablet-lg:grid tablet-lg:grid-rows-subgrid",
  },
} as const satisfies Record<"plain" | "visual", Record<1 | 2 | 3 | 4, string>>;

/**
 * Before and after, side by side: today and with, the old way and the new
 * way. Two `<section>`s, each named by its label as a real heading one
 * level below the section heading.
 *
 * The `before` side sits on the ground in secondary ink, its points marked
 * with a short muted dash; the `after` side is a `Card` plate (the other
 * ground) in primary ink, its points marked with an accent check. The marks
 * and the arrow between the columns are `aria-hidden`: the contrast is in
 * the words, never in colour or marks alone.
 *
 * Side by side, the two sides share one set of grid rows (`subgrid`): each
 * side spans them and places its label group, its copy and its visual on
 * them, so the labels, the copy and the visuals each start on one top line
 * even when one side's description runs longer, and both sides end on one
 * line (the plate fills its column). Both sides carry the same padding.
 * Without `subgrid` support each side still stacks its parts in order.
 *
 * Two columns from `tablet` (from `tablet-lg` when the sides carry visuals,
 * which need the room), stacked below with `before` first. The arrow
 * between the columns flips under `dir="rtl"`, where `before` sits on the
 * right. Server-safe: no hooks.
 */
export function Comparison({ before, after, headingLevel = 3, ground = "base", className, style, ...rest }: ComparisonProps) {
  const withVisuals = hasNode(before.visual) || hasNode(after.visual);
  const rows = Math.min(4, Math.max(sideRows(before), sideRows(after))) as 1 | 2 | 3 | 4;
  const sideGrid = SIDE_ROW_CLASSES[withVisuals ? "visual" : "plain"][rows];

  return (
    <div
      {...rest}
      data-comparison=""
      data-comparison-rows={rows}
      className={cx(
        withVisuals
          ? "relative grid grid-cols-1 gap-lg tablet-lg:grid-cols-2 tablet-lg:gap-x-4xl"
          : "relative grid grid-cols-1 gap-lg tablet:grid-cols-2 tablet:gap-x-4xl",
        className,
      )}
      style={style}
    >
      <section data-comparison-side="before" className={cx("flex min-w-0 flex-col gap-md p-lg tablet:p-xl", sideGrid)}>
        <SideBody side={before} tone="before" headingLevel={headingLevel} ground={ground} />
      </section>
      <span
        aria-hidden="true"
        data-comparison-arrow=""
        className={cx(
          "pointer-events-none absolute inset-0 hidden items-center justify-center",
          withVisuals ? "tablet-lg:flex" : "tablet:flex",
          SECTION_GROUND_CLASSES[ground].muted,
        )}
      >
        <Icon glyph={ArrowRight} decorative size="sm" className="rtl:-scale-x-100" />
      </span>
      <section data-comparison-side="after" className={cx("flex min-w-0 flex-col gap-md", sideGrid)}>
        <Card variant="plate" ground={ground} className={cx("flex flex-1 flex-col gap-md tablet:p-xl", sideGrid)}>
          <SideBody side={after} tone="after" headingLevel={headingLevel} ground={ground} />
        </Card>
      </section>
    </div>
  );
}
