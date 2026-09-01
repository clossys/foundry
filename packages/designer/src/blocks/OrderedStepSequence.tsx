import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";

export type OrderedStepSequenceHeadingLevel = 2 | 3 | 4 | 5 | 6;
export type OrderedStepSequenceGround = "base" | "inverse";

export interface OrderedStepSequenceItem {
  /** Stable identifier — the React key. */
  id: string;
  /** Authored ordinal, exposed as text rather than generated decoration. */
  ordinal: string | number;
  /** A short label above the step heading. */
  label?: ReactNode;
  /** The step's own heading. */
  heading: ReactNode;
  /** Supporting editorial copy for this step. */
  description?: ReactNode;
}

export interface OrderedStepSequenceProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
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

const GROUND_CLASSES: Record<
  OrderedStepSequenceGround,
  { readonly primary: string; readonly secondary: string; readonly line: string; readonly ordinal: string }
> = {
  base: {
    primary: "text-ink-primary",
    secondary: "text-ink-secondary",
    line: "bg-line-base",
    ordinal: "border-line-base text-ink-primary",
  },
  inverse: {
    primary: "text-ink-on-inverse",
    secondary: "text-ink-on-inverse-muted",
    line: "bg-line-on-inverse",
    ordinal: "border-line-on-inverse text-ink-on-inverse",
  },
};

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
 */
export function OrderedStepSequence({
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
  const colors = GROUND_CLASSES[ground];
  const hasHeadingRegion = heading !== undefined || description !== undefined;

  return (
    <section {...rest} className={cx("flex flex-col gap-lg", className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {heading ? <HeadingTag className={cx("text-h2 font-display", colors.primary)}>{heading}</HeadingTag> : null}
          {description ? <p className={cx("text-body", colors.secondary)}>{description}</p> : null}
        </div>
      ) : null}
      <ol className="flex flex-col tablet:flex-row">
        {items.map((item, index) => (
          <li key={item.id} className="flex min-w-0 flex-1 flex-col tablet:flex-row">
            <div className="flex min-w-0 flex-1 flex-row gap-md tablet:flex-col">
              <span
                className={cx(
                  "flex size-xl shrink-0 items-center justify-center rounded-pill border text-body-s font-body font-medium",
                  colors.ordinal,
                )}
              >
                {item.ordinal}
              </span>
              <div className="flex min-w-0 flex-col gap-xs">
                {item.label ? <p className={cx("text-caption uppercase tracking-label", colors.secondary)}>{item.label}</p> : null}
                <ItemHeadingTag className={cx("text-h3 font-display", colors.primary)}>{item.heading}</ItemHeadingTag>
                {item.description ? <p className={cx("text-body-s", colors.secondary)}>{item.description}</p> : null}
              </div>
            </div>
            {index < items.length - 1 ? (
              <span
                aria-hidden="true"
                className={cx("ms-lg my-sm block h-lg w-px shrink-0 tablet:mx-md tablet:my-xl tablet:h-px tablet:w-lg", colors.line)}
              />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
