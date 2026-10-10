import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { assertNoNestedInteractive, CardLinkTitle, cardLinkContainerClassName } from "./stretched-link.js";

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
  /**
   * Links the whole step: the heading becomes the link (its name), with a
   * chevron, and the step cell is the hit area, with a hover plate. Rare:
   * only when each step has a destination of its own. Link every step or
   * none. The step may then hold no other interactive element.
   */
  href?: string;
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
 * The connector and ordinal disc per ground. The connector is `line-strong`
 * on the light grounds (a hairline that stays visible in light and dark
 * schemes without competing with the copy), the inverse line on an inverse
 * band. The ordinal is a 32px disc: the brand's accent tint with an
 * accent-text numeral on the light grounds (the sequence is where the page
 * marks progress, so it carries the accent), an inverse-line ring with
 * on-inverse ink on an inverse band.
 */
const STEP_LINE_CLASSES: Record<SectionGround, { line: string; ordinal: string }> = {
  base: { line: "bg-line-strong", ordinal: "bg-accent-tint text-accent-text" },
  sunken: { line: "bg-line-strong", ordinal: "bg-accent-tint text-accent-text" },
  inverse: { line: "bg-line-on-inverse", ordinal: "border border-line-on-inverse text-ink-on-inverse" },
};

/**
 * Responsive classes for the two layouts. Plain steps go side by side from
 * `tablet`; steps with visuals wait for `tablet-lg` and share subgrid rows
 * (ordinal, text, visual), so every visual starts on one top line whatever
 * the length of the copy above it.
 */
const LAYOUT_CLASSES = {
  plain: {
    list: "flex flex-col tablet:flex-row tablet:gap-x-xl",
    item: "flex min-w-0 flex-1 flex-row gap-md tablet:flex-col tablet:gap-lg",
    marker: "flex shrink-0 flex-col items-center tablet:flex-row",
    connector: "my-sm w-px flex-1 tablet:my-0 tablet:ms-md tablet:-me-md tablet:h-px tablet:w-auto",
    gap: "pb-2xl tablet:pb-0",
  },
  visual: {
    list: "flex flex-col tablet-lg:grid tablet-lg:grid-flow-col tablet-lg:auto-cols-fr tablet-lg:gap-x-xl",
    item: "flex min-w-0 flex-row gap-md tablet-lg:row-span-3 tablet-lg:grid tablet-lg:grid-rows-subgrid tablet-lg:gap-y-lg",
    marker: "flex shrink-0 flex-col items-center tablet-lg:flex-row",
    connector: "my-sm w-px flex-1 tablet-lg:my-0 tablet-lg:ms-md tablet-lg:-me-md tablet-lg:h-px tablet-lg:w-auto",
    body: "flex min-w-0 flex-1 flex-col gap-lg tablet-lg:contents",
    gap: "pb-xl",
  },
} as const;

/**
 * An editorial sequence of ordered steps, not a progress control: it has no
 * current step, completion state, or interaction. A real `<ol>` preserves
 * the order for every reader; `ordinal` remains authored text instead of a
 * generated counter so it is available to assistive technology too.
 *
 * Type follows the content-block hierarchy: a step heading is an item
 * heading, set like a `FeatureGrid` or `TopicList` item heading
 * (`text-body-l`, body font, medium weight), with its actor `label` as a
 * small tracked label above it and its description at `text-body`. Plate
 * headings (`CardGrid`, `Comparison`) sit one step up at `text-h2` in the
 * display font.
 *
 * The connector is decorative (`aria-hidden`) because the list semantics and
 * ordinal already communicate sequence. It is emitted only between adjacent
 * items: a vertical rail from one ordinal down to the next while the list is
 * a column, a horizontal hairline from one ordinal across to the next once
 * it is a row (`tablet`), in `line-strong` so it reads in both colour
 * schemes. `ground` is deliberately closed so the connector never borrows a
 * base-ground line token when it sits on the inverse surface.
 *
 * When any step carries a `visual`, the row starts at `tablet-lg` instead of
 * `tablet` (a visual needs a wider column, so the sequence stays a vertical
 * list with its rail on tablets). In the row each step spans three shared
 * subgrid rows (ordinal, text, visual), so every visual starts on one top
 * line even when one step's copy runs longer. Without `subgrid` support the
 * steps still stack their parts in order.
 *
 * A step with `href` is one link, as a linked `FeatureGrid` item: the
 * heading carries the anchor and a chevron, the step cell is the hit area
 * with a hover plate, and a linked step holding another link, button or
 * field throws a `TypeError`. The sequence stays an editorial list; linking
 * suits only steps that each lead somewhere different.
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
  /** A linked step: a bare item with a hover plate around it. */
  const linkedContainer = cardLinkContainerClassName("plain", ground);
  const lines = STEP_LINE_CLASSES[ground];
  const hasHeadingRegion = eyebrow !== undefined || heading !== undefined || description !== undefined;
  const withVisuals = items.some((item) => item.visual !== undefined && item.visual !== null && item.visual !== false);
  const layout = LAYOUT_CLASSES[withVisuals ? "visual" : "plain"];

  return (
    <section {...rest} className={cx("flex flex-col gap-lg", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {eyebrow ? <p className={cx("text-caption uppercase tracking-label", colors.muted)}>{eyebrow}</p> : null}
          {heading ? <HeadingTag className={cx("text-h2 font-display", colors.primary)}>{heading}</HeadingTag> : null}
          {description ? <p className={cx("text-body", colors.secondary)}>{description}</p> : null}
        </div>
      ) : null}
      <ol data-step-layout={withVisuals ? "visual" : "plain"} className={layout.list}>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          if (item.href !== undefined) assertNoNestedInteractive("OrderedStepSequence", item.id, [item.label, item.heading, item.description, item.visual]);
          const text = (
            <div data-step-text="" className={cx("flex min-w-0 flex-col gap-sm", withVisuals || last ? undefined : LAYOUT_CLASSES.plain.gap)}>
              {item.label ? <p className={cx("text-body-s font-medium uppercase tracking-label", colors.secondary)}>{item.label}</p> : null}
              <ItemHeadingTag className={cx("text-body-l font-body font-medium", colors.primary)}>
                {item.href === undefined ? (
                  item.heading
                ) : (
                  <CardLinkTitle href={item.href} frame="plain" ground={ground}>
                    {item.heading}
                  </CardLinkTitle>
                )}
              </ItemHeadingTag>
              {item.description ? <p className={cx("text-body text-pretty", colors.secondary)}>{item.description}</p> : null}
            </div>
          );
          return (
            <li key={item.id} className={item.href === undefined ? layout.item : cx(layout.item, linkedContainer)}>
              <div className={layout.marker}>
                <span
                  className={cx(
                    "flex size-2xl shrink-0 items-center justify-center rounded-pill text-body font-body font-medium tabular-nums",
                    lines.ordinal,
                  )}
                >
                  {item.ordinal}
                </span>
                {last ? null : <span aria-hidden="true" data-step-connector="" className={cx(layout.connector, lines.line)} />}
              </div>
              {withVisuals ? (
                <div className={cx(LAYOUT_CLASSES.visual.body, last ? undefined : LAYOUT_CLASSES.visual.gap)}>
                  {text}
                  {item.visual ? (
                    <div data-step-visual="" className="w-full min-w-0">
                      {item.visual}
                    </div>
                  ) : null}
                </div>
              ) : (
                text
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
