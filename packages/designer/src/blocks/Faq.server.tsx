import { SectionHeader } from "./SectionHeader.js";
import { cx } from "../components/internal/cx.js";
import type { FaqProps } from "./Faq.js";
import { SECTION_MEASURE_MAX } from "./internal/block-vars.js";
import { nativeDisclosureRow } from "./internal/disclosure-row.server.js";
import { SECTION_GROUND_CLASSES } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.faq", "foundry/sections.faq");

/**
 * One row recipe for both FAQ implementations (this file and the React Aria
 * `Faq.tsx`), so the server and client lists look the same. Kept here, not
 * under `internal/`, so the compiled-CSS class scan sees every literal.
 *
 * - `list`: a divider above the first question; `item`: one below each, so
 *   every question sits between two ground-matched hairlines. The row stays
 *   in block flow: a flex `details` does not ease its `::details-content`
 *   height (the block-size transition jumps), so the trigger and answer
 *   stack as ordinary blocks.
 * - `trigger`: the whole row is the hit area (full width, `py-lg`, `py-xl`
 *   from tablet), the question at the body-l step, the chevron at the end,
 *   the package-standard focus-visible outline. On `summary` the native
 *   marker is hidden (`summary-marker-none`, a Designer utility);
 *   the chevron is the open/closed cue instead.
 * - `chevron`: rotates half a turn when open (`disclosure-icon-motion`).
 * - `details` (native rows) and `panel` (React Aria rows): the open/close
 *   height ease (`details-motion`, `disclosure-panel-motion`: CSS only, on
 *   the motion tokens, instant under reduced motion; see `theme-keys.css`).
 * - `answer`: under the question at the body step, kept to the prose
 *   measure. It sits inside the animated element and carries the row's
 *   bottom padding, so a closed row collapses to exactly zero.
 */
export const FAQ_ROW_CLASSES = {
  list: "flex flex-col border-t",
  item: "group/faq block border-b",
  trigger:
    "flex w-full cursor-pointer items-center justify-between gap-lg rounded-default py-lg text-start text-body-l font-medium tablet:py-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent summary-marker-none",
  details: "details-motion",
  panel: "disclosure-panel-motion",
  chevron: "shrink-0 disclosure-icon-motion",
  chevronOpen: "rotate-180",
  chevronNative: "group-open/faq:rotate-180",
  answer: "pb-lg pe-2xl text-body text-pretty tablet:pb-xl",
} as const;

/** The answer's measure: long answers wrap at the prose width, not the full column. */
export const FAQ_ANSWER_STYLE = { maxWidth: SECTION_MEASURE_MAX.prose } as const;

/**
 * The React-server-safe FAQ implementation. Native `details`/`summary`
 * preserves independent, keyboard-operable disclosure behavior without
 * reaching the client-only React Aria graph. The native marker is hidden and
 * a Designer `ChevronDown` (rotating on `[open]`, CSS only) is the cue; the
 * answer's height eases open and shut through `::details-content`, CSS only. The ordinary blocks barrel keeps
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
  const colors = SECTION_GROUND_CLASSES[ground];
  const hasHeadingRegion = eyebrow !== undefined || heading !== undefined || description !== undefined;

  return (
    <div {...SECTION_STAMP} {...rest} className={cx("flex flex-col gap-lg", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <SectionHeader density="standard" level={headingLevel} ground={ground} eyebrow={eyebrow} description={description} {...(heading ? { title: heading } : {})} titleClassName="leading-heading" />
      ) : null}
      <div className={cx(FAQ_ROW_CLASSES.list, colors.border)}>
        {items.map(item => nativeDisclosureRow({ id: item.id, question: item.question, answer: item.answer, recipe: FAQ_ROW_CLASSES, colors, answerStyle: FAQ_ANSWER_STYLE }))}
      </div>
    </div>
  );
}
