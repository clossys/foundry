import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Icon } from "../atoms/Icon.js";
import { ArrowRight } from "../icons/ArrowRight.js";
import { cx } from "../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { assertNoNestedInteractive, CardLinkTitle, cardLinkContainerClassName } from "./stretched-link.js";

export type OrderedStepSequenceHeadingLevel = 2 | 3 | 4 | 5 | 6;
export type OrderedStepSequenceGround = SectionGround;

export interface OrderedStepSequenceItem {
  /** Actor lane, only when the sequence names two lanes. */
  lane?: "a" | "b";
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
  /** Two named actors; each step uses its lane name in place of label. */
  lanes?: { a: ReactNode; b: ReactNode };
  /** Real heading id naming the ordered list. */
  labelledBy?: string;
  /** Visual sample or source caption, outside the list. */
  caption?: ReactNode;
  /** Opts an ordinary sequence into a final connector. Lanes default to ends. */
  end?: "continues" | "ends";
  endLabel?: ReactNode;
  /** Consumer-resolved hidden text for an unlabelled continuing end. */
  continuesLabel?: ReactNode;
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
const STEP_LINE_CLASSES: Record<SectionGround, { line: string; border: string; ink: string; ordinal: string }> = {
  base: { line: "bg-line-strong", border: "border-line-strong", ink: "text-line-strong", ordinal: "bg-accent-tint text-accent-text" },
  sunken: { line: "bg-line-strong", border: "border-line-strong", ink: "text-line-strong", ordinal: "bg-accent-tint text-accent-text" },
  inverse: { line: "bg-line-on-inverse", border: "border-line-on-inverse", ink: "text-line-on-inverse", ordinal: "border border-line-on-inverse text-ink-on-inverse" },
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

/** Lane geometry uses a half-gap handoff: outgoing and incoming pieces meet there. */
const LANE_LAYOUTS = {
  3: {
    list: "flex flex-col gap-2xl pb-xl tablet-lg:grid tablet-lg:grid-cols-3 tablet-lg:pb-0",
    item: "relative flex min-w-0 flex-col ps-[calc(var(--spacing-2xl)+var(--spacing-lg))] tablet-lg:ps-0",
    lower: "ms-xl tablet-lg:ms-0 tablet-lg:mt-4xl",
    marker: "absolute start-0 top-0 tablet-lg:relative tablet-lg:flex tablet-lg:items-center",
    label: "absolute start-[calc(var(--spacing-2xl)+var(--spacing-lg))] top-0 tablet-lg:static tablet-lg:ms-sm",
    body: "flex min-w-0 flex-col gap-lg pt-2xl tablet-lg:pt-lg",
    connector: "absolute start-[calc(var(--spacing-2xl)/2)] top-2xl -bottom-[calc(var(--spacing-2xl)/2)] w-[length:var(--ui-border-hairline)] tablet-lg:top-[calc(var(--spacing-2xl)/2)] tablet-lg:bottom-auto tablet-lg:start-[calc(var(--spacing-2xl)/2)] tablet-lg:h-[length:var(--ui-border-hairline)] tablet-lg:w-full",
    final: "-bottom-xl tablet-lg:w-[calc(100%_-_var(--spacing-2xl)/2)]",
    join: "tablet-lg:-start-[calc(var(--spacing-2xl)/2)] tablet-lg:w-2xl",
    same: "start-[calc(var(--spacing-2xl)/2)] w-0 border-s-[length:var(--ui-border-hairline)] tablet-lg:top-[calc(var(--spacing-2xl)/2)] tablet-lg:h-0 tablet-lg:border-s-0 tablet-lg:border-t-[length:var(--ui-border-hairline)]",
    down: "start-[calc(var(--spacing-2xl)/2_-_var(--spacing-xl))] w-xl border-t-[length:var(--ui-border-hairline)] border-e-[length:var(--ui-border-hairline)] [border-start-end-radius:var(--radius-control)] tablet-lg:top-[calc(var(--spacing-2xl)/2_-_var(--spacing-4xl))] tablet-lg:h-4xl tablet-lg:border-t-0 tablet-lg:border-e-0 tablet-lg:border-s-[length:var(--ui-border-hairline)] tablet-lg:border-b-[length:var(--ui-border-hairline)] tablet-lg:[border-start-end-radius:0] tablet-lg:[border-end-start-radius:var(--radius-control)]",
    up: "start-[calc(var(--spacing-2xl)/2)] w-xl border-t-[length:var(--ui-border-hairline)] border-s-[length:var(--ui-border-hairline)] [border-start-start-radius:var(--radius-control)] tablet-lg:top-[calc(var(--spacing-2xl)/2)] tablet-lg:h-4xl",
    end: "absolute start-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 rtl:translate-x-1/2 tablet-lg:start-auto tablet-lg:end-0 tablet-lg:top-1/2 tablet-lg:bottom-auto tablet-lg:translate-x-1/2 tablet-lg:-translate-y-1/2 tablet-lg:rtl:-translate-x-1/2",
    arrow: "rotate-90 tablet-lg:rotate-0 tablet-lg:rtl:rotate-180",
    endLabel: "absolute start-[calc(var(--spacing-2xl)+var(--spacing-lg))] -bottom-xl tablet-lg:start-auto tablet-lg:end-0 tablet-lg:bottom-auto tablet-lg:top-0 tablet-lg:-translate-y-full",
  },
  5: {
    list: "flex flex-col gap-2xl pb-xl desktop:grid desktop:grid-cols-5 desktop:pb-0",
    item: "relative flex min-w-0 flex-col ps-[calc(var(--spacing-2xl)+var(--spacing-lg))] desktop:ps-0",
    lower: "ms-xl desktop:ms-0 desktop:mt-4xl",
    marker: "absolute start-0 top-0 desktop:relative desktop:flex desktop:items-center",
    label: "absolute start-[calc(var(--spacing-2xl)+var(--spacing-lg))] top-0 desktop:static desktop:ms-sm",
    body: "flex min-w-0 flex-col gap-lg pt-2xl desktop:pt-lg",
    connector: "absolute start-[calc(var(--spacing-2xl)/2)] top-2xl -bottom-[calc(var(--spacing-2xl)/2)] w-[length:var(--ui-border-hairline)] desktop:top-[calc(var(--spacing-2xl)/2)] desktop:bottom-auto desktop:start-[calc(var(--spacing-2xl)/2)] desktop:h-[length:var(--ui-border-hairline)] desktop:w-full",
    final: "-bottom-xl desktop:w-[calc(100%_-_var(--spacing-2xl)/2)]",
    join: "desktop:-start-[calc(var(--spacing-2xl)/2)] desktop:w-2xl",
    same: "start-[calc(var(--spacing-2xl)/2)] w-0 border-s-[length:var(--ui-border-hairline)] desktop:top-[calc(var(--spacing-2xl)/2)] desktop:h-0 desktop:border-s-0 desktop:border-t-[length:var(--ui-border-hairline)]",
    down: "start-[calc(var(--spacing-2xl)/2_-_var(--spacing-xl))] w-xl border-t-[length:var(--ui-border-hairline)] border-e-[length:var(--ui-border-hairline)] [border-start-end-radius:var(--radius-control)] desktop:top-[calc(var(--spacing-2xl)/2_-_var(--spacing-4xl))] desktop:h-4xl desktop:border-t-0 desktop:border-e-0 desktop:border-s-[length:var(--ui-border-hairline)] desktop:border-b-[length:var(--ui-border-hairline)] desktop:[border-start-end-radius:0] desktop:[border-end-start-radius:var(--radius-control)]",
    up: "start-[calc(var(--spacing-2xl)/2)] w-xl border-t-[length:var(--ui-border-hairline)] border-s-[length:var(--ui-border-hairline)] [border-start-start-radius:var(--radius-control)] desktop:top-[calc(var(--spacing-2xl)/2)] desktop:h-4xl",
    end: "absolute start-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 rtl:translate-x-1/2 desktop:start-auto desktop:end-0 desktop:top-1/2 desktop:bottom-auto desktop:translate-x-1/2 desktop:-translate-y-1/2 desktop:rtl:-translate-x-1/2",
    arrow: "rotate-90 desktop:rotate-0 desktop:rtl:rotate-180",
    endLabel: "absolute start-[calc(var(--spacing-2xl)+var(--spacing-lg))] -bottom-xl desktop:start-auto desktop:end-0 desktop:bottom-auto desktop:top-0 desktop:-translate-y-full",
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
  lanes,
  labelledBy,
  caption,
  end,
  endLabel,
  continuesLabel,
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

  const foundation = lanes !== undefined || end !== undefined || endLabel !== undefined;
  const effectiveEnd = end ?? "ends";
  if (end !== undefined && end !== "ends" && end !== "continues") throw new TypeError("OrderedStepSequence: end must be ends or continues.");
  if (foundation && effectiveEnd === "continues" && endLabel === undefined && (continuesLabel === undefined || continuesLabel === null || continuesLabel === false)) throw new TypeError("OrderedStepSequence: an unlabelled continuing end needs consumer continuesLabel copy.");
  if (caption !== undefined && !withVisuals) throw new TypeError("OrderedStepSequence: caption needs a step visual.");
  if (lanes !== undefined) {
    if (items.length !== 3 && items.length !== 5) throw new RangeError("OrderedStepSequence: lanes need 3 or 5 steps.");
    if (withVisuals && items.length !== 3) throw new RangeError("OrderedStepSequence: lane visuals need exactly 3 steps.");
    if (items.some((item) => item.lane !== "a" && item.lane !== "b")) throw new TypeError("OrderedStepSequence: every lane step needs lane a or b.");
    if (items.some((item) => item.label !== undefined)) throw new TypeError("OrderedStepSequence: lane names replace item labels.");
    if (items[0]?.lane !== "a" || !items.some((item) => item.lane === "b")) throw new TypeError("OrderedStepSequence: start in lane a and use both actors.");
  } else if (items.some((item) => item.lane !== undefined)) throw new TypeError("OrderedStepSequence: item lane needs block lanes.");
  const terminal = (position: string, arrow: string) => (
    <span aria-hidden="true" data-step-end={effectiveEnd} className={cx(position, effectiveEnd === "ends" ? "size-[var(--ui-icon-sm)] rounded-pill" : undefined, effectiveEnd === "ends" ? lines.line : lines.ink)}>
      {effectiveEnd === "continues" ? <Icon glyph={ArrowRight} decorative size="sm" className={arrow} /> : null}
    </span>
  );
  const terminalLabel = (position: string) => endLabel !== undefined || effectiveEnd === "continues" ? (
    <span data-step-end-label="" className={cx(endLabel === undefined ? "sr-only" : position, "text-body-s", colors.secondary)}>{endLabel ?? continuesLabel}</span>
  ) : null;
  const laneLayout = LANE_LAYOUTS[items.length === 5 ? 5 : 3];
  const ordinaryEnd = withVisuals ? {
    position: "absolute start-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 rtl:translate-x-1/2 tablet-lg:start-auto tablet-lg:end-0 tablet-lg:top-1/2 tablet-lg:bottom-auto tablet-lg:translate-x-1/2 tablet-lg:-translate-y-1/2 tablet-lg:rtl:-translate-x-1/2",
    arrow: "rotate-90 tablet-lg:rotate-0 tablet-lg:rtl:rotate-180",
    label: "absolute start-[calc(var(--spacing-2xl)+var(--spacing-lg))] -bottom-xl tablet-lg:start-auto tablet-lg:end-0 tablet-lg:top-0 tablet-lg:bottom-auto tablet-lg:-translate-y-full",
  } : {
    position: "absolute start-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 rtl:translate-x-1/2 tablet:start-auto tablet:end-0 tablet:top-1/2 tablet:bottom-auto tablet:translate-x-1/2 tablet:-translate-y-1/2 tablet:rtl:-translate-x-1/2",
    arrow: "rotate-90 tablet:rotate-0 tablet:rtl:rotate-180",
    label: "absolute start-[calc(var(--spacing-2xl)+var(--spacing-lg))] -bottom-xl tablet:start-auto tablet:end-0 tablet:top-0 tablet:bottom-auto tablet:-translate-y-full",
  };

  return (
    <section {...rest} className={cx(lanes === undefined ? "flex flex-col gap-lg" : "flex flex-col", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {eyebrow ? <p className={cx("text-caption uppercase tracking-label", colors.muted)}>{eyebrow}</p> : null}
          {heading ? <HeadingTag className={cx("text-h2 font-display", colors.primary)}>{heading}</HeadingTag> : null}
          {description ? <p className={cx("text-body", colors.secondary)}>{description}</p> : null}
        </div>
      ) : null}
      {lanes !== undefined ? (
        <ol data-step-layout={withVisuals ? "visual" : "plain"} data-step-lanes="" aria-labelledby={labelledBy} className={cx(laneLayout.list, hasHeadingRegion ? "mt-lg" : undefined)}>
          {items.map((item, index) => {
            const previous = items[index - 1];
            const join = previous === undefined ? undefined : previous.lane === item.lane ? "same" : item.lane === "b" ? "down" : "up";
            const last = index === items.length - 1;
            const actor = lanes[item.lane!];
            if (item.href !== undefined) assertNoNestedInteractive("OrderedStepSequence", item.id, [actor, item.heading, item.description, item.visual]);
            return (
              <li key={item.id} data-lane={item.lane} className={cx(laneLayout.item, item.lane === "b" ? laneLayout.lower : undefined, item.href === undefined ? undefined : linkedContainer)}>
                {join === undefined ? null : <span aria-hidden="true" data-step-join={join} className={cx("pointer-events-none absolute -top-[calc(var(--spacing-2xl)/2)] h-2xl", lines.border, laneLayout[join], laneLayout.join)} />}
                <span aria-hidden="true" data-step-connector="" data-end={last ? effectiveEnd : undefined} className={cx("pointer-events-none", laneLayout.connector, last ? laneLayout.final : undefined, lines.line)}>
                  {last ? terminal(laneLayout.end, laneLayout.arrow) : null}
                </span>
                <div className={laneLayout.marker}>
                  <span className={cx("relative z-10 flex size-2xl shrink-0 items-center justify-center rounded-pill text-body font-body font-medium tabular-nums", lines.ordinal)}>{item.ordinal}</span>
                  <p data-step-lane-label="" className={cx("z-10 w-max px-sm text-body-s font-medium uppercase tracking-label", laneLayout.label, colors.secondary, colors.surface || "bg-surface-base")}>{actor}</p>
                </div>
                <div className={laneLayout.body}>
                  <div data-step-text="" className="flex min-w-0 flex-col gap-sm">
                    <ItemHeadingTag className={cx("text-body-l font-body font-medium", colors.primary)}>{item.href === undefined ? item.heading : <CardLinkTitle href={item.href} frame="plain" ground={ground}>{item.heading}</CardLinkTitle>}</ItemHeadingTag>
                    {item.description ? <p className={cx("text-body text-pretty", colors.secondary)}>{item.description}</p> : null}
                  </div>
                  {item.visual ? <div data-step-visual="" className="w-full min-w-0">{item.visual}</div> : null}
                </div>
                {last ? terminalLabel(laneLayout.endLabel) : null}
              </li>
            );
          })}
        </ol>
      ) : (
      <ol data-step-layout={withVisuals ? "visual" : "plain"} aria-labelledby={labelledBy} className={layout.list}>
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
            <li key={item.id} className={cx(item.href === undefined ? layout.item : cx(layout.item, linkedContainer), foundation ? "relative pb-xl" : undefined)}>
              <div className={layout.marker}>
                <span
                  className={cx(
                    "flex size-2xl shrink-0 items-center justify-center rounded-pill text-body font-body font-medium tabular-nums",
                    lines.ordinal,
                  )}
                >
                  {item.ordinal}
                </span>
                {last && !foundation ? null : <span aria-hidden="true" data-step-connector="" data-end={last && foundation ? effectiveEnd : undefined} className={cx(layout.connector, lines.line, last && foundation ? "relative min-h-xl" : undefined)}>{last && foundation ? terminal(ordinaryEnd.position, ordinaryEnd.arrow) : null}</span>}
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
              {last && foundation ? terminalLabel(ordinaryEnd.label) : null}
            </li>
          );
        })}
      </ol>
      )}
      {caption !== undefined ? <p data-step-caption="" className={cx("text-caption", lanes === undefined ? "mt-[calc(var(--spacing-xl)_-_var(--spacing-lg))]" : "mt-xl", colors.secondary)}>{caption}</p> : null}
    </section>
  );
}
