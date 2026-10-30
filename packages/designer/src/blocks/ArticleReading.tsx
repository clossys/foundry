import type { ReactNode } from "react";

/** Stable CSS identifiers and escaped selectors; caller ids never become CSS syntax. */
export function readingTarget(id: string): { name: string; selector: string } {
  const points = Array.from(id, character => character.codePointAt(0)!.toString(16));
  return { name: "--article-" + points.join("-"), selector: '[id="' + points.map(point => "\\" + point + " ").join("") + '"]' };
}

export const ARTICLE_PROGRESS_CSS = `
[data-article-progress]{display:none;transform-origin:inline-start}
@keyframes article-reading-progress{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@supports(animation-timeline:scroll()){
 @media(prefers-reduced-motion:no-preference){
  [data-article-progress]{display:block;transform-origin:left;animation:article-reading-progress linear both;animation-timeline:scroll(root block)}
 }
}
@media(prefers-reduced-motion:reduce){[data-article-progress]{display:none!important;animation:none!important}}
`;

/** A decorative wrapper for the frame's host-supplied progress component; no estimated value is announced. */
export function ArticleReadingProgress({ children }: { children: ReactNode }) {
  return <><style>{ARTICLE_PROGRESS_CSS}</style><div data-article-progress="" aria-hidden="true">{children}</div></>;
}

/** Unsupported CSS and reduced motion retain the ordinary anchor navigation. */
export function articleTocCss(items: readonly { id: string }[]): string {
  const targets = items.map(item => readingTarget(item.id));
  return `@keyframes article-reading-current{from,to{text-decoration:underline;border-inline-start-color:currentColor}}
@supports(animation-timeline:scroll()){@media(prefers-reduced-motion:no-preference){
[data-article-reading]{timeline-scope:${targets.map(target => target.name).join(",")}}
${targets.map(target => `[data-article-reading] ${target.selector}{view-timeline-name:${target.name};view-timeline-axis:block}\n[data-reading-target="${target.name}"]{animation:article-reading-current 1ms linear;animation-timeline:${target.name};animation-range:entry 0% exit 100%;animation-fill-mode:none}`).join("\n")}
}}
@media(prefers-reduced-motion:reduce){[data-reading-target]{animation:none!important}}`;
}
