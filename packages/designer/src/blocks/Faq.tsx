import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Disclosure } from "../atoms/Disclosure.js";
import { cx } from "../atoms/internal/cx.js";

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
  className?: string;
  style?: CSSProperties;
}

/**
 * A list of expand/collapse question/answer pairs — an optional heading
 * region above the list, which is what makes `Faq` a block, not an atom
 * (this package's README, "Placement rules", test 2: the heading and the
 * list differ in kind, even though the ITEMS inside the list are a
 * homogeneous repeat, the same shape `FeatureGrid`'s items and `NavGrid`'s
 * cards already are). A page can hold two `Faq`s (a general FAQ block and a
 * product-specific one further down the same page), which is what makes it
 * a block rather than a view (test 3).
 *
 * **Built on this package's own `Disclosure` atom, one per item, rather
 * than a hand-rolled expand/collapse mechanism.** `Disclosure` already
 * supplies everything a single expand/collapse section needs — real
 * `aria-expanded`/`aria-controls` wiring, Enter/Space-and-click toggling,
 * and keeping collapsed content in the DOM (`hidden`, not unmounted) so
 * browser find-in-page can still reach it — built on
 * react-aria-components' own `Disclosure`/`DisclosurePanel` (see
 * `Disclosure`'s own doc comment for the full accounting of what it
 * supplies). None of that is reimplemented here: `Faq` renders `items.map`
 * straight into one `Disclosure` per question, nothing more. Each
 * question/answer pair expands and collapses INDEPENDENTLY — `Faq` renders
 * no `DisclosureGroup` and holds no shared "which one is open" state of its
 * own, so opening one question never closes another (the single-section
 * primitive `Disclosure`'s own doc comment describes, not an accordion of
 * coordinated ones — a real accordion, where opening one closes the rest,
 * would compose react-aria-components' `DisclosureGroup` instead, and
 * isn't what a FAQ list needs: a reader routinely wants two answers open
 * at once to compare them).
 *
 * Items render inside a plain list with a hairline divider between them
 * (`border-t border-line-base` on every item after the first) — visual
 * grouping only; the real structure a screen reader needs comes from each
 * `Disclosure`'s own trigger/panel wiring, not from a `role="list"` this
 * block would otherwise have to fake.
 */
export function Faq({
  heading,
  description,
  items,
  headingLevel = 2,
  className,
  style,
  ...rest
}: FaqProps) {
  const HeadingTag = `h${headingLevel}` as `h${FaqHeadingLevel}`;
  const hasHeadingRegion = heading !== undefined || description !== undefined;

  return (
    <div {...rest} className={cx("flex flex-col gap-lg", className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {heading ? (
            <HeadingTag className="text-h2 font-display text-ink-primary">{heading}</HeadingTag>
          ) : null}
          {description ? (
            <p className="text-body text-ink-secondary">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col">
        {items.map((item, index) => (
          <Disclosure
            key={item.id}
            title={item.question}
            className={index > 0 ? "border-t border-line-base pt-xs" : undefined}
          >
            {item.answer}
          </Disclosure>
        ))}
      </div>
    </div>
  );
}
