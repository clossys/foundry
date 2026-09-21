/* ════════════════════════════════════════════════════════════════════
 * @clossys/designer · mark-template.tsx
 * ────────────────────────────────────────────────────────────────────
 * MASTER BRAND MARK — copy this template into your own project and fill
 * every blank, the same way you copy `brand-template.css` into `brand.css`:
 *
 *   cp node_modules/@clossys/designer/templates/mark-template.tsx \
 *      src/brand/mark.tsx
 *
 * Import tokens and your brand overlay first in CSS:
 *
 *   @import "@clossys/designer/tokens.css";
 *   @import "./brand.css";
 *
 * THREE VARIANTS (all required once you bind a wordmark):
 *
 *   BrandLockup        — mark glyph + wordmark for default surfaces
 *   BrandMark            — mark glyph only
 *   BrandLockupInverse   — mark + wordmark on inverse surface/ink tokens
 *
 * Run `designer-mark-check src/brand/mark.tsx` after filling in
 * `BRAND_WORDMARK` and your mark glyph. This package does not emit favicon
 * PNGs, touch icons, or Open Graph images — only the master SVG lockup.
 * ════════════════════════════════════════════════════════════════════ */

import type { HTMLAttributes } from "react";
import { Icon } from "@clossys/designer/atoms";
import { Box } from "@clossys/designer/icons";
import type { IconNode } from "@clossys/designer/icons";

/** Replace with your product wordmark text. */
export const BRAND_WORDMARK = "REPLACE_ME";

/**
 * Replace with your mark glyph from `@clossys/designer/icons`, or pass custom
 * SVG children to `Icon` instead of `glyph` below.
 */
export const BRAND_MARK_GLYPH: IconNode = Box;

export type BrandMarkProps = Omit<HTMLAttributes<HTMLSpanElement>, "children">;

export function BrandMark({ className, style, ...rest }: BrandMarkProps) {
  return (
    <span className={className} style={{ display: "inline-flex", lineHeight: 0, ...style }} {...rest}>
      <Icon glyph={BRAND_MARK_GLYPH} decorative size="lg" />
    </span>
  );
}

export function BrandLockup({ className, style, ...rest }: BrandMarkProps) {
  return (
    <span
      className={["inline-flex items-center gap-sm", className].filter(Boolean).join(" ")}
      style={style}
      {...rest}
    >
      <Icon glyph={BRAND_MARK_GLYPH} decorative size="lg" />
      <span className="font-display text-body font-medium text-ink-primary">{BRAND_WORDMARK}</span>
    </span>
  );
}

export function BrandLockupInverse({ className, style, ...rest }: BrandMarkProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-sm rounded-default bg-surface-inverse px-sm py-xs",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      {...rest}
    >
      <Icon glyph={BRAND_MARK_GLYPH} decorative size="lg" className="text-ink-on-inverse" />
      <span className="font-display text-body font-medium text-ink-on-inverse">{BRAND_WORDMARK}</span>
    </span>
  );
}
