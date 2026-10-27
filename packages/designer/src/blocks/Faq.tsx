import { SectionHeader } from "./SectionHeader.js";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { FAQ_ANSWER_STYLE, FAQ_ROW_CLASSES } from "./Faq.server.js";
import { disclosureRow } from "./internal/disclosure-row.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.faq", "foundry/sections.faq");

export type FaqHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface FaqItem {
  /** Stable identifier — the React key. */
  id: string;
  /** The always-visible question text. */
  question: ReactNode;
  /** The answer, present in the DOM but hidden until expanded. */
  answer: ReactNode;
}

export interface FaqProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Small label above the block's own heading, the same slot `FeatureGrid` and `Hero` already ship. */
  eyebrow?: ReactNode;
  /** Optional heading above the question list. */
  heading?: ReactNode;
  /** A line of supporting copy under the heading. */
  description?: ReactNode;
  /** The question/answer pairs to render, as data. */
  items: readonly FaqItem[];
  /**
   * Which heading element `heading` renders as — the same `SectionHeader`-
   * derived reasoning `FeatureGrid`'s own `headingLevel` documents.
   * @default 2
   */
  headingLevel?: FaqHeadingLevel;
  /** Semantic section ground; selects the complete matching surface and foreground policy. @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

/**
 * A list of expand/collapse question/answer pairs — an optional heading
 * region above the list, which is what makes `Faq` a block, not an component
 * (this package's README, "Placement rules", test 2: the heading and the
 * list differ in kind, even though the ITEMS inside the list are a
 * homogeneous repeat, the same shape `FeatureGrid`'s items and `NavGrid`'s
 * cards already are). A page can hold two `Faq`s (a general FAQ block and a
 * product-specific one further down the same page), which is what makes it
 * a block rather than a view (test 3).
 *
 * **Built on react-aria-components' own `Disclosure`/`DisclosurePanel`, one
 * per item, rather than a hand-rolled expand/collapse mechanism** (the same
 * primitives this package's `Disclosure` component wraps). They supply real
 * `aria-expanded`/`aria-controls` wiring, Enter/Space-and-click toggling,
 * and keep collapsed content in the DOM (`hidden`, not unmounted) so
 * browser find-in-page can still reach it. `Faq` composes them directly,
 * not through the component, so the row can take the FAQ recipe
 * (`FAQ_ROW_CLASSES`, shared with the server implementation): the whole row
 * as the hit area, the question at the body-l step, and a Designer
 * `ChevronDown` at the end that turns when open, and the answer's height
 * eases open and shut (`disclosure-panel-motion`, CSS on the
 * `--disclosure-panel-height` React Aria sets; instant under reduced
 * motion). Each
 * question/answer pair expands and collapses INDEPENDENTLY — `Faq` renders
 * no `DisclosureGroup` and holds no shared "which one is open" state of its
 * own, so opening one question never closes another (the single-section
 * primitive `Disclosure`'s own doc comment describes, not an accordion of
 * coordinated ones — a real accordion, where opening one closes the rest,
 * would compose react-aria-components' `DisclosureGroup` instead, and
 * isn't what a FAQ list needs: a reader routinely wants two answers open
 * at once to compare them).
 *
 * Items render inside a plain list between ground-matched hairlines (one
 * above the first question, one below each) — visual grouping only; the
 * real structure a screen reader needs comes from each disclosure's own
 * trigger/panel wiring, not from a `role="list"` this block would otherwise
 * have to fake.
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
        {items.map(item => disclosureRow({ id: item.id, question: item.question, answer: item.answer, recipe: FAQ_ROW_CLASSES, colors, answerStyle: FAQ_ANSWER_STYLE }))}
      </div>
    </div>
  );
}
