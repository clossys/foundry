import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { DISPLAY_HEADING_CLASS } from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

export type MarketingChapterHeadingLevel = 2 | 3;

export interface MarketingChapterProps extends HTMLAttributes<HTMLElement> {
  /** Chapter title — marketing scale (`text-h2`), not settings `SectionHeader` scale. */
  title: ReactNode;
  /** Prose body — typically `ArticleBody` or equivalent long-form content. */
  children?: ReactNode;
  /** Optional supporting line under the title. */
  description?: ReactNode;
  /**
   * Heading level for the chapter title. Defaults to `2` for a page whose
   * hero already consumed `<h1>`.
   * @default 2
   */
  headingLevel?: MarketingChapterHeadingLevel;
  /** Semantic section ground; selects surface and foreground policy. @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

/**
 * Full-bleed marketing chapter band: a marketing-scale title (`text-h2`) and
 * a prose slot. Use for fold-after chapters instead of `SectionHeader`,
 * which is intentionally settings-scale (`text-h3`).
 */
export function MarketingChapter({
  title,
  description,
  children,
  headingLevel = 2,
  ground = "base",
  className,
  style,
  ...rest
}: MarketingChapterProps) {
  const HeadingTag = headingLevel === 2 ? "h2" : "h3";
  const colors = SECTION_GROUND_CLASSES[ground];

  return (
    <section
      {...rest}
      className={cx(colors.surface, "flex flex-col gap-lg py-2xl", className)}
      style={style}
    >
      <div className="flex flex-col items-start gap-md">
        <HeadingTag className={cx("text-h2 font-display max-w-display", colors.primary)}>{title}</HeadingTag>
        {description ? <p className={cx("text-body-l", colors.secondary)}>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
