import { Icon } from "../atoms/Icon.js";
import { cx } from "../atoms/internal/cx.js";
import { ChevronDown } from "../icons/ChevronDown.js";
import type { FaqHeadingLevel, FaqProps } from "./Faq.js";
import { SECTION_MEASURE_MAX } from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES } from "./section-ground.js";

/**
 * One row recipe for both FAQ implementations (this file and the React Aria
 * `Faq.tsx`), so the server and client lists look the same. Kept here, not
 * under `internal/`, so the compiled-CSS class scan sees every literal.
 *
 * - `list`: a divider above the first question; `item`: one below each, so
 *   every question sits between two ground-matched hairlines.
 * - `trigger`: the whole row is the hit area (full width, `py-lg`, `py-xl`
 *   from tablet), the question at the body-l step, the chevron at the end,
 *   the package-standard focus-visible outline. On `summary` the native
 *   marker is hidden (`summary-marker-none`, a Designer utility);
 *   the chevron is the open/closed cue instead.
 * - `chevron`: rotates half a turn when open, with no transition under
 *   reduced motion.
 * - `answer`: under the question at the body step, kept to the prose measure.
 */
export const FAQ_ROW_CLASSES = {
  list: "flex flex-col border-t",
  item: "group/faq flex flex-col border-b",
  trigger:
    "flex w-full cursor-pointer items-center justify-between gap-lg rounded-default py-lg text-start text-body-l font-medium tablet:py-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent summary-marker-none",
  chevron: "shrink-0 transition-transform motion-reduce:transition-none",
  chevronOpen: "rotate-180",
  answer: "pb-lg pe-2xl text-body text-pretty tablet:pb-xl",
} as const;

/** The answer's measure: long answers wrap at the prose width, not the full column. */
export const FAQ_ANSWER_STYLE = { maxWidth: SECTION_MEASURE_MAX.prose } as const;

/**
 * The React-server-safe FAQ implementation. Native `details`/`summary`
 * preserves independent, keyboard-operable disclosure behavior without
 * reaching the client-only React Aria graph. The native marker is hidden and
 * a Designer `ChevronDown` (rotating on `[open]`, CSS only) is the cue. The ordinary blocks barrel keeps
 * exporting the React Aria implementation from `Faq.tsx`; only
 * `@clossys/designer/blocks/server` selects this implementation.
 */
export function Faq({
  eyebrow,
  heading,
  description,
  items,
  headingLevel = 2,
  ground = "base",
  className,
  style,
  ...rest
}: FaqProps) {
  const HeadingTag = `h${headingLevel}` as `h${FaqHeadingLevel}`;
  const colors = SECTION_GROUND_CLASSES[ground];
  const hasHeadingRegion = eyebrow !== undefined || heading !== undefined || description !== undefined;

  return (
    <div {...rest} className={cx("flex flex-col gap-lg", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {eyebrow ? <p className={cx("text-caption uppercase tracking-label", colors.muted)}>{eyebrow}</p> : null}
          {heading ? (
            <HeadingTag className={cx("text-h2 font-display", colors.primary)}>{heading}</HeadingTag>
          ) : null}
          {description ? <p className={cx("text-body", colors.secondary)}>{description}</p> : null}
        </div>
      ) : null}
      <div className={cx(FAQ_ROW_CLASSES.list, colors.border)}>
        {items.map((item) => (
          <details key={item.id} className={cx(FAQ_ROW_CLASSES.item, colors.border)}>
            <summary className={cx(FAQ_ROW_CLASSES.trigger, colors.primary)}>
              <span>{item.question}</span>
              <Icon
                glyph={ChevronDown}
                decorative
                size="md"
                className={cx(FAQ_ROW_CLASSES.chevron, "group-open/faq:rotate-180")}
              />
            </summary>
            <div className={cx(FAQ_ROW_CLASSES.answer, colors.secondary)} style={FAQ_ANSWER_STYLE}>
              {item.answer}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
