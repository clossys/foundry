import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

export type OrderedStepSequenceHeadingLevel = 2 | 3 | 4 | 5 | 6;
export type OrderedStepSequenceGround = SectionGround;

export interface OrderedStepSequenceItem {
  /** Stable identifier — the React key. */
  id: string;
  /** Authored ordinal, exposed as text rather than generated decoration. */
  ordinal: string | number;
  /** A short label above the step heading: the actor tag for the step ("Your team", "The reviewer"). */
  label?: ReactNode;
  /** The step's own heading. */
  heading: ReactNode;
  /** Supporting editorial copy for this step. */
  description?: ReactNode;
  /**
   * Optional small visual under the step text (typically a one-panel
   * `Specimen`). When any step carries one, the sequence switches to the
   * visual layout described on the component.
   */
  visual?: ReactNode;
}

export interface OrderedStepSequenceProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Small label above the block's own heading, the same slot `FeatureGrid` and `Hero` already ship. */
  eyebrow?: ReactNode;
  /** Optional heading above the ordered sequence. */
  heading?: ReactNode;
  /** Supporting copy under the sequence heading. */
  description?: ReactNode;
  /** Ordered, editorial steps. Their source order is their reading order. */
  items: readonly OrderedStepSequenceItem[];
  /** Which heading element the sequence heading uses; item headings render one rank lower, capped at h6. @default 2 */
  headingLevel?: OrderedStepSequenceHeadingLevel;
  /** The ground this block is placed on; it selects matching connector and ink tokens. @default "base" */
  ground?: OrderedStepSequenceGround;
  className?: string;
  style?: CSSProperties;
}

/**
 * An editorial sequence of ordered steps, not a progress control: it has no
 * current step, completion state, or interaction. A real `<ol>` preserves
 * the order for every reader; `ordinal` remains authored text instead of a
 * generated counter so it is available to assistive technology too.
 *
 * The connector is decorative (`aria-hidden`) because the list semantics and
 * ordinal already communicate sequence. It is emitted only between adjacent
 * items, then switches from a vertical rule to a horizontal rule at the same
 * `tablet` breakpoint where the list changes from a column to a row. `ground`
 * is deliberately closed so the connector never borrows a base-ground line
 * token when it sits on the inverse surface.
 *
 * When any step carries a `visual`, the row starts at `tablet-lg` instead of
 * `tablet` (a visual needs a wider column, so the sequence stays a vertical
 * list with its rail on tablets), the steps are top-aligned
 * (`tablet-lg:items-start`) and each visual follows its step text directly,
 * so steps with parallel copy put their visuals on one top line.
 * Without visuals the markup is unchanged.
 */
export function OrderedStepSequence({
  eyebrow,
  heading,
  description,
  items,
  headingLevel = 2,
  ground = "base",
  className,
  style,
  ...rest
}: OrderedStepSequenceProps) {
  const HeadingTag = `h${headingLevel}` as `h${OrderedStepSequenceHeadingLevel}`;
  const ItemHeadingTag = `h${Math.min(headingLevel + 1, 6)}` as `h${OrderedStepSequenceHeadingLevel}`;
  const colors = SECTION_GROUND_CLASSES[ground];
  const hasHeadingRegion = eyebrow !== undefined || heading !== undefined || description !== undefined;
  const withVisuals = items.some((item) => item.visual !== undefined && item.visual !== null && item.visual !== false);

  return (
    <section {...rest} className={cx("flex flex-col gap-lg", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {eyebrow ? <p className={cx("text-caption uppercase tracking-label", colors.muted)}>{eyebrow}</p> : null}
          {heading ? <HeadingTag className={cx("text-h2 font-display", colors.primary)}>{heading}</HeadingTag> : null}
          {description ? <p className={cx("text-body", colors.secondary)}>{description}</p> : null}
        </div>
      ) : null}
      <ol className={withVisuals ? "flex flex-col tablet-lg:flex-row tablet-lg:items-start" : "flex flex-col tablet:flex-row"}>
        {items.map((item, index) => (
          <li
            key={item.id}
            className={withVisuals ? "flex min-w-0 flex-1 flex-col tablet-lg:flex-row" : "flex min-w-0 flex-1 flex-col tablet:flex-row"}
          >
            <div
              className={
                withVisuals
                  ? "flex min-w-0 flex-1 flex-row gap-md tablet-lg:flex-col"
                  : "flex min-w-0 flex-1 flex-row gap-md tablet:flex-col"
              }
            >
              <span
                className={cx(
                  "flex size-xl shrink-0 items-center justify-center rounded-pill border text-body-s font-body font-medium",
                  colors.border,
                  colors.primary,
                )}
              >
                {item.ordinal}
              </span>
              <div className={withVisuals ? "flex min-w-0 flex-1 flex-col gap-xs" : "flex min-w-0 flex-col gap-xs"}>
                {item.label ? <p className={cx("text-caption uppercase tracking-label", colors.secondary)}>{item.label}</p> : null}
                <ItemHeadingTag className={cx("text-h3 font-display", colors.primary)}>{item.heading}</ItemHeadingTag>
                {item.description ? <p className={cx("text-body-s", colors.secondary)}>{item.description}</p> : null}
                {item.visual ? (
                  <div data-step-visual="" className="w-full min-w-0 pt-lg">
                    {item.visual}
                  </div>
                ) : null}
              </div>
            </div>
            {index < items.length - 1 ? (
              <span
                aria-hidden="true"
                className={cx(
                  withVisuals
                    ? "ms-lg my-sm block h-lg w-px shrink-0 tablet-lg:mx-md tablet-lg:my-xl tablet-lg:h-px tablet-lg:w-lg"
                    : "ms-lg my-sm block h-lg w-px shrink-0 tablet:mx-md tablet:my-xl tablet:h-px tablet:w-lg",
                  colors.line,
                )}
              />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
