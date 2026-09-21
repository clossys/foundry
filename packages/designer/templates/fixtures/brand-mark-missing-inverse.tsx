/**
 * Red fixture: lockup authored but inverse variant removed.
 */

import type { HTMLAttributes } from "react";
import { Icon } from "@clossys/designer/atoms";
import { Box } from "@clossys/designer/icons";
import type { IconNode } from "@clossys/designer/icons";

export const BRAND_WORDMARK = "Fixture";

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
