import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { ArticleReadingProgress } from "./ArticleReading.js";
import { Link } from "../components/Link.js";
import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.article", "foundry/sections.article");
export interface ArticleBodyProps extends HTMLAttributes<HTMLElement> {
  /**
   * Pre-structured content — headings, paragraphs, lists, a blockquote,
   * inline code, a code block, images, a horizontal rule. Rendered exactly
   * as given, nothing added or removed. The only required prop.
   */
  children: ReactNode;
  /**
   * Optional table-of-contents region, usually a `TableOfContents`. When
   * given, it sits beside the body from desktop (above it below desktop),
   * and the body's typography scale moves onto an inner body column so it
   * never restyles the navigation's own links and list. Omitted, the
   * article renders exactly as before.
   */
  toc?: ReactNode;
  /** First paragraph uses a token-backed initial; opt-in only. */
  dropCap?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** The body typography scale: descendant variants over registered token utilities. */
const ARTICLE_TYPOGRAPHY = [
  "flex flex-col gap-md",
  "[&_h1]:text-h1 [&_h1]:font-display [&_h1]:text-ink-primary [&_h1]:mt-xl",
  "[&_h2]:text-h2 [&_h2]:font-display [&_h2]:text-ink-primary [&_h2]:mt-lg",
  "[&_h3]:text-h3 [&_h3]:font-display [&_h3]:text-ink-primary [&_h3]:mt-md",
  "[&_h4]:text-h3 [&_h4]:font-display [&_h4]:text-ink-primary [&_h4]:mt-md",
  "[&_h5]:text-h3 [&_h5]:font-display [&_h5]:text-ink-primary [&_h5]:mt-md",
  "[&_h6]:text-h3 [&_h6]:font-display [&_h6]:text-ink-primary [&_h6]:mt-md",
  "[&_p]:text-body [&_p]:text-ink-primary",
  "[&_a]:text-ink-link [&_a]:underline",
  "[&_ul]:list-disc [&_ul]:ps-lg [&_ul]:text-body [&_ul]:text-ink-primary",
  "[&_ol]:list-decimal [&_ol]:ps-lg [&_ol]:text-body [&_ol]:text-ink-primary",
  "[&_li]:text-body [&_li]:text-ink-primary",
  "[&_blockquote]:text-blockquote [&_blockquote]:font-display [&_blockquote]:text-ink-secondary [&_blockquote]:border-s [&_blockquote]:border-line-base [&_blockquote]:ps-lg",
  "[&_strong]:font-semibold [&_strong]:text-ink-primary",
  "[&_em]:italic",
  "[&_code]:font-mono [&_code]:text-body-s [&_code]:text-ink-primary [&_code]:bg-surface-sunken [&_code]:rounded-subtle [&_code]:px-xs",
  "[&_pre]:font-mono [&_pre]:text-code-block [&_pre]:text-ink-primary [&_pre]:bg-surface-sunken [&_pre]:rounded-control [&_pre]:p-md [&_pre]:overflow-x-auto",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_hr]:border-line-base",
  "[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-control",
] as const;

/** With a toc: one column below desktop, then the region in the first of four columns and the body across three. */
const ARTICLE_TOC_CLASSES = {
  root: "grid grid-cols-1 gap-xl desktop:grid-cols-4",
  region: "min-w-0",
  body: "min-w-0 desktop:col-span-3",
} as const;

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
 * **Measure comes from `SectionFrame`, not from this component.** Render
 * inside `SectionFrame` (`measure="prose"` for long-form copy). This
 * wrapper only applies typography; the frame owns padding, ground, and
 * `--ui-width-prose-max`.
 */
function ArticleBodyRoot({ children, toc, dropCap = false, className, style, ...rest }: ArticleBodyProps) {
  const initial = dropCap ? "[&>p:first-of-type::first-letter]:float-start [&>p:first-of-type::first-letter]:font-display [&>p:first-of-type::first-letter]:text-display [&>p:first-of-type::first-letter]:pe-xs" : undefined;
  if (toc !== undefined && toc !== null && toc !== false) {
    return (
      <article {...SECTION_STAMP} {...rest} data-article-reading="" className={cx(ARTICLE_TOC_CLASSES.root, className)} data-designer-requires-section-frame="" style={style}>
        <div data-article-toc="" className={ARTICLE_TOC_CLASSES.region}>{toc}</div>
        <div data-article-body="" className={cx(...ARTICLE_TYPOGRAPHY, ARTICLE_TOC_CLASSES.body, initial)}>{children}</div>
      </article>
    );
  }
  return (
    <article
      {...SECTION_STAMP} {...rest}
      className={cx(...ARTICLE_TYPOGRAPHY, initial, className)}
      data-designer-requires-section-frame=""
      style={style}
    >
      {children}
    </article>
  );
}


/** Editorial parts keep copy in caller-owned nodes and never parse a document. */
function ArticlePullQuote({ children, attribution }: { children: ReactNode; attribution?: ReactNode }) {
  return <blockquote data-article-pull-quote="" className="border-s border-line-base ps-lg text-blockquote font-display text-ink-secondary">{children}{attribution ? <footer className="mt-sm text-body-s font-body text-ink-muted">{attribution}</footer> : null}</blockquote>;
}
function ArticleFigureCaption({ children }: { children: ReactNode }) {
  return <figcaption data-article-figure-caption="" className="mt-sm text-caption text-ink-muted">{children}</figcaption>;
}
function ArticleFootnoteReference({ id, noteId, children }: { id: string; noteId: string; children: ReactNode }) {
  assertFootnoteId(id); assertFootnoteId(noteId);
  return <sup><Link id={id} href={"#" + noteId} data-footnote-reference="">{children}</Link></sup>;
}
function assertFootnoteId(value: string): void {
  if (typeof value !== "string" || !value || /[\s#]/.test(value)) throw new TypeError("ArticleBody: footnote ids must be nonempty fragment ids.");
}
function ArticleFootnotes({ label, items }: { label: string; items: readonly { id: string; referenceId: string; body: ReactNode; backlink: ReactNode }[] }) {
  if (!label.trim()) throw new TypeError("ArticleBody: footnotes require a host label.");
  const ids = new Set<string>();
  for (const item of items) { assertFootnoteId(item.id); assertFootnoteId(item.referenceId); if (ids.has(item.id)) throw new TypeError("ArticleBody: footnote ids must be unique."); ids.add(item.id); }
  return <section role="doc-endnotes" aria-label={label}><ol className="flex flex-col gap-sm">{items.map(item => <li key={item.id} id={item.id} role="doc-endnote">{item.body}<Link href={"#" + item.referenceId} data-footnote-backlink="">{item.backlink}</Link></li>)}</ol></section>;
}

export const ArticleBody = Object.assign(ArticleBodyRoot, { PullQuote: ArticlePullQuote, FigureCaption: ArticleFigureCaption, FootnoteReference: ArticleFootnoteReference, Footnotes: ArticleFootnotes, Progress: ArticleReadingProgress });
