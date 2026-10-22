import type { CSSProperties } from "react";
import { Logomark } from "@clossys/designer/atoms/server";
import type { AppFrameBrand as Brand } from "./app-frame-types.js";

const BRAND = "inline-flex min-w-0 items-center justify-center gap-sm rounded-control text-ink-primary no-underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent tablet:justify-start";
const MARK = { inlineSize: "var(--ui-brandmark-height-sm, 24px)", blockSize: "var(--ui-brandmark-height-sm, 24px)" };
function normalize(value: string): string { return value.replace(/\s+/g, " ").trim().toLowerCase(); }

/** AppFrame's resolved brand renderer; the mark is decorative within one named lockup. */
export function AppFrameBrand({ markSrc, wordmark, label, markInk = "accent", href }: Brand) {
  if (!markSrc.trim() || !wordmark.trim() || !label.trim()) throw new TypeError("AppFrame: brand source, wordmark and label must be non-empty.");
  if (!normalize(label).includes(normalize(wordmark))) throw new TypeError("AppFrame: brand label must contain the visible wordmark.");
  const source = `url(${JSON.stringify(markSrc)})`;
  const mask: CSSProperties = { ...MARK, maskImage: source, WebkitMaskImage: source, maskPosition: "center", WebkitMaskPosition: "center", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskSize: "contain", WebkitMaskSize: "contain" };
  const content = <>
    {markInk === "image" ? <Logomark src={markSrc} size="sm" plate="self" /> :
      <span data-application-frame-mark="accent" aria-hidden="true" className="block shrink-0 bg-accent forced-colors:bg-[CanvasText]" style={mask} />}
  </>;
  const style = { minBlockSize: "var(--ui-layout-tap-target, 44px)", minInlineSize: "var(--ui-layout-tap-target, 44px)" };
  return href ? <a href={href} aria-label={label} className={BRAND} style={style}>{content}</a> :
    <span role="img" aria-label={label} className={BRAND} style={style}>{content}</span>;
}
