import { SectionHeader } from "./SectionHeader.js";
import { useId, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import type { AccordionItem, AccordionTrigger, AccordionContent } from "../components/preview-runtime/components/disclosure/accordion.js";
import { componentLeaf } from "../runtime/component-leaf.js";
import { cx } from "../components/internal/cx.js";
import { FAQ_ANSWER_STYLE, faqColumns, faqLists } from "./Faq.server.js";

import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.faq", "foundry/sections.faq");

// These ports name the selected source's real exports, declared by the consumer descriptor.
const SelectedItem = componentLeaf<typeof AccordionItem>("components.disclosure", "AccordionItem");
const SelectedTrigger = componentLeaf<typeof AccordionTrigger>("components.disclosure", "AccordionTrigger");
const SelectedContent = componentLeaf<typeof AccordionContent>("components.disclosure", "AccordionContent");

export type FaqHeadingLevel = 2 | 3 | 4 | 5 | 6;
/** How the questions are laid out: one list, or two side-by-side lists from tablet. */
export type FaqLayout = "list" | "two-column";

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
  /**
   * `list` is the single vertical list. `two-column` splits the questions
   * into two lists, first half first, that stack below tablet and sit side
   * by side from it; each keeps the hairlines and its questions open
   * independently, and the reading order stays the item order.
   * @default "list"
   */
  layout?: FaqLayout;
  className?: string;
  style?: CSSProperties;
}

/**
 * Caller-authored questions and answers rendered through the consumer's selected
 * disclosure leaf. The group allows several answers to stay open. Selected
 * trigger/content exports own keyboard behavior, focus and disclosure styling;
 * no component implementation is imported as a runtime fallback.
 */
export function Faq({
  eyebrow,
  heading,
  description,
  items,
  headingLevel = 2,
  ground = "base",
  layout = "list",
  className,
  style,
  ...rest
}: FaqProps) {
  const scope = useId();
  const colors = SECTION_GROUND_CLASSES[ground];
  const hasHeadingRegion = eyebrow !== undefined || heading !== undefined || description !== undefined;
  const columns = faqColumns(items, layout).map(column => column.map(item => (
    <SelectedItem key={item.id} id={`${scope}-${item.id}`}>
      <SelectedTrigger>{item.question}</SelectedTrigger>
      <SelectedContent><div style={FAQ_ANSWER_STYLE}>{item.answer}</div></SelectedContent>
    </SelectedItem>
  )));

  return (
    <SemanticContent as="div" {...SECTION_STAMP} {...rest} className={cx("flex flex-col gap-lg", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <SectionHeader density="standard" level={headingLevel} ground={ground} eyebrow={eyebrow} description={description} {...(heading ? { title: heading } : {})} titleClassName="leading-heading" />
      ) : null}
      {faqLists(columns, layout, colors.border)}
    </SemanticContent>
  );
}
