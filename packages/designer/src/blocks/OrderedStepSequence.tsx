import { SectionHeader } from "./SectionHeader.js";
import { SemanticContent } from "../components/SemanticContent.js";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.steps", "foundry/sections.steps");

export type OrderedStepSequenceHeadingLevel = 2 | 3 | 4 | 5 | 6;
export type OrderedStepSequenceGround = SectionGround;

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

const STEP_LINE_CLASSES: Record<SectionGround, { line: string; border: string; ink: string; ordinal: string }> = {
  base: { line: "bg-line-strong", border: "border-line-strong", ink: "text-line-strong", ordinal: "bg-accent-tint text-accent-text" },
  sunken: { line: "bg-line-strong", border: "border-line-strong", ink: "text-line-strong", ordinal: "bg-accent-tint text-accent-text" },
  inverse: { line: "bg-line-on-inverse", border: "border-line-on-inverse", ink: "text-line-on-inverse", ordinal: "border border-line-on-inverse text-ink-on-inverse" },
};

const LAYOUT_CLASSES = {
  list: "flex flex-col tablet:flex-row tablet:gap-x-xl",
  item: "flex min-w-0 flex-1 flex-row gap-md tablet:flex-col tablet:gap-lg",
  marker: "flex shrink-0 flex-col items-center tablet:flex-row",
  connector: "my-sm w-px flex-1 tablet:my-0 tablet:ms-md tablet:-me-md tablet:h-px tablet:w-auto",
  gap: "pb-2xl tablet:pb-0",
} as const;

/** Authored editorial order with decorative connectors only between adjacent steps. */
export function OrderedStepSequence({ eyebrow, heading, description, items, headingLevel = 2, ground = "base", className, style, ...rest }: OrderedStepSequenceProps) {
  const ItemHeadingTag = `h${Math.min(headingLevel + 1, 6)}` as `h${OrderedStepSequenceHeadingLevel}`;
  const colors = SECTION_GROUND_CLASSES[ground];
  const lines = STEP_LINE_CLASSES[ground];
  const hasHeadingRegion = eyebrow !== undefined || heading !== undefined || description !== undefined;
  return (
    <section {...SECTION_STAMP} {...rest} className={cx("flex flex-col gap-lg", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <SectionHeader density="standard" level={headingLevel} ground={ground} eyebrow={eyebrow} description={description} {...(heading ? { title: heading } : {})} />
      ) : null}
      <ol data-step-layout="plain" className={LAYOUT_CLASSES.list}>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          const text = (
            <div data-step-text="" className={cx("flex min-w-0 flex-col gap-sm", last ? undefined : LAYOUT_CLASSES.gap)}>
              {item.label ? <SemanticContent as="p" className={cx("text-body-s font-medium uppercase tracking-label", colors.secondary)}>{item.label}</SemanticContent> : null}
              <SemanticContent as={ItemHeadingTag} className={cx("text-body-l font-body font-medium", colors.primary)}>{item.heading}</SemanticContent>
              {item.description ? <SemanticContent as="p" className={cx("text-body text-pretty", colors.secondary)}>{item.description}</SemanticContent> : null}
            </div>
          );
          return (
            <li key={item.id} className={LAYOUT_CLASSES.item}>
              <div className={LAYOUT_CLASSES.marker}>
                <SemanticContent as="span" className={cx("flex size-2xl shrink-0 items-center justify-center rounded-pill text-body font-body font-medium tabular-nums", lines.ordinal)}>{item.ordinal}</SemanticContent>
                {last ? null : <SemanticContent as="span" aria-hidden="true" data-step-connector="" className={cx(LAYOUT_CLASSES.connector, lines.line)} />}
              </div>
              {text}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
