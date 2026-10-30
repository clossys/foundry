import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { ArticleReadingProgress } from "./ArticleReading.js";
import { componentLeaf } from "../runtime/component-leaf.js";
const Link = componentLeaf<typeof import("../components/Link.js").Link>("components.link");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const Card = componentLeaf<typeof import("../components/preview-runtime/components/card/card.js").Card>("components.card");
const CardContent = componentLeaf<typeof import("../components/preview-runtime/components/card/card.js").CardContent>("components.card", "CardContent");
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

/** Editorial layout and typography; consumer-selected component leaves own all visible content. */
function ArticleBodyRoot({ children, toc, dropCap = false, className, style, ...rest }: ArticleBodyProps) {
  const initial = dropCap ? "[&>p:first-of-type::first-letter]:float-start [&>p:first-of-type::first-letter]:font-display [&>p:first-of-type::first-letter]:text-display [&>p:first-of-type::first-letter]:pe-xs" : undefined;
  if (toc !== undefined && toc !== null && toc !== false) {
    return (
      <SemanticContent as="article" {...SECTION_STAMP} {...rest} data-article-reading="" className={cx(ARTICLE_TOC_CLASSES.root, className)} data-designer-requires-section-frame="" style={style}>
        <SemanticContent as="div" data-article-toc="" className={ARTICLE_TOC_CLASSES.region}>{toc}</SemanticContent>
        <SemanticContent as="div" data-article-body="" className={cx(...ARTICLE_TYPOGRAPHY, ARTICLE_TOC_CLASSES.body, initial)}>{children}</SemanticContent>
      </SemanticContent>
    );
  }
  return (
    <SemanticContent as="article"
      {...SECTION_STAMP} {...rest}
      className={cx(...ARTICLE_TYPOGRAPHY, initial, className)}
      data-designer-requires-section-frame=""
      style={style}
    >
      {children}
    </SemanticContent>
  );
}


/** Editorial parts keep copy in caller-owned nodes and never parse a document. */
function ArticlePullQuote({ children, attribution }: { children: ReactNode; attribution?: ReactNode }) {
  return <Card><CardContent><SemanticContent as="blockquote" data-article-pull-quote="" className="border-s border-line-base ps-lg text-blockquote font-display text-ink-secondary">{children}{attribution ? <SemanticContent as="footer" className="mt-sm text-body-s font-body text-ink-muted">{attribution}</SemanticContent> : null}</SemanticContent></CardContent></Card>;
}
function ArticleFigureCaption({ children }: { children: ReactNode }) {
  return <SemanticContent as="figcaption" data-article-figure-caption="" className="mt-sm text-caption text-ink-muted">{children}</SemanticContent>;
}
function ArticleFootnoteReference({ id, noteId, children }: { id: string; noteId: string; children: ReactNode }) {
  assertFootnoteId(id); assertFootnoteId(noteId);
  return <SemanticContent as="sup"><Link id={id} href={"#" + noteId} data-footnote-reference="">{children}</Link></SemanticContent>;
}
function assertFootnoteId(value: string): void {
  if (typeof value !== "string" || !value || /[\s#]/.test(value)) throw new TypeError("ArticleBody: footnote ids must be nonempty fragment ids.");
}
function ArticleFootnotes({ label, items }: { label: string; items: readonly { id: string; referenceId: string; body: ReactNode; backlink: ReactNode }[] }) {
  if (typeof label !== "string" || !label.trim()) throw new TypeError("ArticleBody: footnotes require a host label.");
  const ids = new Set<string>(), references = new Set<string>();
  for (const item of items) { assertFootnoteId(item.id); assertFootnoteId(item.referenceId); if (item.id === item.referenceId || ids.has(item.id) || references.has(item.referenceId)) throw new TypeError("ArticleBody: footnote ids must be unique."); ids.add(item.id); references.add(item.referenceId); }
  return <SemanticContent as="section" role="doc-endnotes" aria-label={label}><SemanticContent as="ol" className="flex flex-col gap-sm">{items.map(item => <SemanticContent as="li" key={item.id} id={item.id} role="doc-endnote">{item.body}<Link href={"#" + item.referenceId} data-footnote-backlink="">{item.backlink}</Link></SemanticContent>)}</SemanticContent></SemanticContent>;
}

export const ArticleBody = Object.assign(ArticleBodyRoot, { PullQuote: ArticlePullQuote, FigureCaption: ArticleFigureCaption, FootnoteReference: ArticleFootnoteReference, Footnotes: ArticleFootnotes, Progress: ArticleReadingProgress });
