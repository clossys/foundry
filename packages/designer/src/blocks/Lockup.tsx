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
  as: Root = "span", href, "aria-label": label, className, markTone, presentation, geometry }: LockupProps) {
  const vars = SIZE_VARS[presentation !== undefined && geometry !== undefined ? "lg" : size];
  const markHeight = presentation === "mobile" && geometry !== undefined ? "var(--ui-layout-tap-target, 44px)" : vars.height;
  const inverse = tone === "inverse";
  const showWordmark = !(presentation === "mobile" && geometry !== undefined)
    && typeof wordmark === "string" && wordmark.trim() !== "";
  if (presentation === "responsive" && geometry !== undefined) {
    return <Root href={Root === "a" ? href : undefined} aria-label={label}
      className={cx("inline-flex items-center", inverse ? "text-ink-on-inverse" : "text-ink-primary", className)}>
      <span className="hidden desktop:block"><span className="inline-flex items-center" style={{
        ...(showWordmark ? { gap: vars.gap } : {}), ...(clearSpace ? { padding: `calc(${vars.height} * 0.2)` } : {}),
      }}>
        <Logomark src={src} size={size} tone={markTone} plate={plate} geometry={geometry}
          presentation={presentation === "responsive" ? "desktop" : presentation} />
        {showWordmark ? <span className="font-display leading-none" style={{ fontSize: vars.wordmark }}>{wordmark}</span> : null}
      </span></span>
      <span className="inline-flex desktop:hidden" style={clearSpace ? { padding: "calc(var(--ui-layout-tap-target, 44px) * 0.2)" } : undefined}>
        <Logomark src={src} size={size} tone={markTone} plate={plate} geometry={geometry}
          presentation={presentation === "responsive" ? "mobile" : presentation} />
      </span>
    </Root>;
  }
  const style: CSSProperties | undefined = showWordmark || clearSpace ? {
    ...(showWordmark ? { gap: vars.gap } : {}),
    ...(clearSpace ? { padding: `calc(${markHeight} * 0.2)` } : {}),
  } : undefined;
  const markRegion = <Logomark src={src} size={size} tone={markTone} plate={plate} presentation={presentation} geometry={geometry} />;
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
