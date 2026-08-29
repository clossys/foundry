import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { UI_WIDTH_PROSE_MAX } from "./internal/block-vars.js";

export interface ArticleBodyProps extends HTMLAttributes<HTMLElement> {
  /**
   * Pre-structured content — headings, paragraphs, lists, a blockquote,
   * inline code, a code block, images, a horizontal rule. Rendered exactly
   * as given, nothing added or removed. The only required prop.
   */
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * A semantic content region for a marketing/editorial page's long-form
 * body — one region, so this ships as a thin wrapper rather than a
 * multi-region block, but a page can hold two `ArticleBody`s (a main
 * article plus a sidebar callout, or two comparison columns), which is
 * what keeps it at this layer rather than being a view (this package's
 * README, "Placement rules", test 3).
 *
 * **Deliberately narrow scope: a styled container, not a content-shape
 * parser.** This does NOT parse markdown, does NOT enforce a content-shape
 * schema, and does NOT walk or clone `children` to inspect what's inside —
 * it accepts ordinary pre-structured React children (real `<h2>`,
 * `<p>`, `<ul>`, ... elements, however a consumer produced them) and
 * applies this package's token-driven typography scale to them via CSS
 * descendant selectors, nothing more. A product-neutral structured-
 * document contract (parsing a content shape into these elements in the
 * first place) is explicitly out of scope here and belongs to a separate,
 * already-filed proposal in `@example/surface` instead — building
 * that here would be exactly the kind of speculative, un-asked-for scope
 * growth this repository's own contribution conventions warn against.
 *
 * **Styling is applied via `[&_element]:token-class` descendant variants
 * on the outer `<article>`, never via a global `.prose`-shaped stylesheet
 * class.** Every child element this scale styles renders through a
 * TOKEN-BACKED Tailwind utility class the same way every other component
 * in this package does (`text-h2`, `text-ink-primary`, `bg-surface-sunken`,
 * ...) — `token-gate.ts`'s scanner has nothing to flag here, since a
 * descendant-selector VARIANT (`[&_h2]:...`) carries no hardcoded value of
 * its own, only a reference to this package's already-registered utility
 * vocabulary. Renders a real `<article>` — a self-contained composition,
 * correctly reusable more than once per page (unlike `<header>`/`<footer>`,
 * which register a landmark that can't legally repeat at the top level).
 *
 * Content is constrained to `--ui-width-prose-max` (48rem default,
 * this package's own reading-measure token) — the same "case 2, no
 * Tailwind namespace" raw `var()` read `Shell.Main`'s own
 * `--ui-width-content-max` uses, applied via inline `style` for the exact
 * reason that file documents: Tailwind's `@theme inline` has no namespace
 * for a one-off content width the way it does for spacing/radius/colour.
 */
export function ArticleBody({ children, className, style, ...rest }: ArticleBodyProps) {
  return (
    <article
      {...rest}
      className={cx(
        "flex flex-col gap-md",
        "[&_h1]:text-h1 [&_h1]:font-display [&_h1]:text-ink-primary [&_h1]:mt-xl",
        "[&_h2]:text-h2 [&_h2]:font-display [&_h2]:text-ink-primary [&_h2]:mt-lg",
        "[&_h3]:text-h3 [&_h3]:font-display [&_h3]:text-ink-primary [&_h3]:mt-md",
        "[&_h4]:text-h3 [&_h4]:font-display [&_h4]:text-ink-primary [&_h4]:mt-md",
        "[&_h5]:text-h3 [&_h5]:font-display [&_h5]:text-ink-primary [&_h5]:mt-md",
        "[&_h6]:text-h3 [&_h6]:font-display [&_h6]:text-ink-primary [&_h6]:mt-md",
        "[&_p]:text-body [&_p]:text-ink-primary",
        "[&_a]:text-ink-link [&_a]:underline",
        "[&_ul]:list-disc [&_ul]:pl-lg [&_ul]:text-body [&_ul]:text-ink-primary",
        "[&_ol]:list-decimal [&_ol]:pl-lg [&_ol]:text-body [&_ol]:text-ink-primary",
        "[&_li]:text-body [&_li]:text-ink-primary",
        "[&_blockquote]:text-blockquote [&_blockquote]:font-display [&_blockquote]:text-ink-secondary [&_blockquote]:border-l [&_blockquote]:border-line-base [&_blockquote]:pl-lg",
        "[&_strong]:font-semibold [&_strong]:text-ink-primary",
        "[&_em]:italic",
        "[&_code]:font-mono [&_code]:text-body-s [&_code]:text-ink-primary [&_code]:bg-surface-sunken [&_code]:rounded-subtle [&_code]:px-xs",
        "[&_pre]:font-mono [&_pre]:text-code-block [&_pre]:text-ink-primary [&_pre]:bg-surface-sunken [&_pre]:rounded-control [&_pre]:p-md [&_pre]:overflow-x-auto",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_hr]:border-line-base",
        "[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-control",
        className,
      )}
      style={{ maxWidth: UI_WIDTH_PROSE_MAX, ...style }}
    >
      {children}
    </article>
  );
}
