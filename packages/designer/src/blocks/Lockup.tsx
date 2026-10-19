import type { CSSProperties } from "react";
import { Logomark, type LogomarkProps } from "../atoms/Logomark.js";
import { cx } from "../atoms/internal/cx.js";
import {
  UI_BRANDMARK_GAP_SM, UI_BRANDMARK_GAP_MD, UI_BRANDMARK_GAP_LG,
  UI_BRANDMARK_HEIGHT_SM, UI_BRANDMARK_HEIGHT_MD, UI_BRANDMARK_HEIGHT_LG,
  UI_BRANDMARK_WORDMARK_SIZE_SM, UI_BRANDMARK_WORDMARK_SIZE_MD, UI_BRANDMARK_WORDMARK_SIZE_LG,
} from "../internal/brandmark.js";

export interface LockupProps extends Omit<LogomarkProps, "title"> {
  /** Live text in the wordmark region. Blank text leaves only the mark. */
  wordmark: string;
  /** Pad every side by one fifth of the mark height. @default false */
  clearSpace?: boolean;
  /** Native root; an anchor lets a shell compose without an extra wrapper. */
  as?: "span" | "a";
  href?: string;
  "aria-label"?: string;
  /** Additional root classes, merged with the layout and ink defaults. */
  className?: string;
  /** Plate ink, independent of the wordmark `tone`; omitted, Logomark's own default applies. */
  markTone?: LogomarkProps["tone"];
}

const SIZE_VARS = {
  sm: { height: UI_BRANDMARK_HEIGHT_SM, gap: UI_BRANDMARK_GAP_SM, wordmark: UI_BRANDMARK_WORDMARK_SIZE_SM },
  md: { height: UI_BRANDMARK_HEIGHT_MD, gap: UI_BRANDMARK_GAP_MD, wordmark: UI_BRANDMARK_WORDMARK_SIZE_MD },
  lg: { height: UI_BRANDMARK_HEIGHT_LG, gap: UI_BRANDMARK_GAP_LG, wordmark: UI_BRANDMARK_WORDMARK_SIZE_LG },
};

/** Mark and wordmark regions in reading order, aligned on their vertical centers. */
export function Lockup({ src, size, wordmark, tone = "auto", plate, clearSpace = false,
  as: Root = "span", href, "aria-label": label, className, markTone }: LockupProps) {
  const vars = SIZE_VARS[size];
  const inverse = tone === "inverse";
  const showWordmark = typeof wordmark === "string" && wordmark.trim() !== "";
  const style: CSSProperties | undefined = showWordmark || clearSpace ? {
    ...(showWordmark ? { gap: vars.gap } : {}),
    ...(clearSpace ? { padding: `calc(${vars.height} * 0.2)` } : {}),
  } : undefined;
  const markRegion = <Logomark src={src} size={size} tone={markTone} plate={plate} />;
  const wordmarkRegion = showWordmark
    ? <span className="font-display leading-none" style={{ fontSize: vars.wordmark }}>{wordmark}</span>
    : null;
  return (
    <Root
      href={Root === "a" ? href : undefined}
      aria-label={label}
      className={cx("inline-flex items-center", inverse ? "text-ink-on-inverse" : "text-ink-primary", className)}
      style={style}
    >
      {markRegion}
      {wordmarkRegion}
    </Root>
  );
}
