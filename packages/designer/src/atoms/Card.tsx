import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "./internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_ELEVATION_RAISED } from "./internal/ui-vars.js";

/**
 * - `"raised"` (default): the original card, unchanged — raised fill,
 *   `rounded-control`, the hairline elevation shadow.
 * - `"plate"`: a content plate. It reads as the OTHER ground from the
 *   section it sits on (see `ground`), with `rounded-surface`, no stroke
 *   and no shadow — a card made by a change of ground, not by a box.
 * - `"outline"`: a product panel. Raised fill, one hairline edge,
 *   `rounded-surface`, never a shadow.
 */
export type CardVariant = "raised" | "plate" | "outline";

/**
 * The ground of the section a card sits on. An atom cannot see its
 * section, so a `plate` (and an `outline` on an inverse band) is told it
 * here rather than guessing. Mirrors the block layer's section grounds.
 */
export type CardGround = "base" | "sunken" | "inverse";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** @default "raised" */
  variant?: CardVariant;
  /**
   * The ground the card sits on. Read by `plate` (which fills with the
   * other ground) and by `outline` (whose edge follows the ground's line
   * colour). Ignored by `raised`.
   * @default "base"
   */
  ground?: CardGround;
}

// A plate is the other ground: on base it sinks, on sunken it rises, and
// on an inverse band it takes the inverse raised fill.
const PLATE_CLASSES: Record<CardGround, string> = {
  base: "bg-surface-sunken",
  sunken: "bg-surface-raised",
  inverse: "bg-surface-inverse-raised",
};

const OUTLINE_CLASSES: Record<CardGround, string> = {
  base: "border border-line-base bg-surface-raised",
  sunken: "border border-line-base bg-surface-raised",
  inverse: "border border-line-on-inverse bg-surface-inverse-raised",
};

/**
 * A content surface. Not interactive and does not compose another atom —
 * plain markup, no react-aria-components primitive needed, unlike
 * `Button` and `TextField` (see this package's README). Server-safe: no
 * hooks, so it is re-exported from `atoms/server.ts`.
 */
export function Card({ variant = "raised", ground = "base", className, style, children, ...rest }: CardProps) {
  if (variant === "plate") {
    return (
      <div {...rest} data-variant="plate" className={cx("rounded-surface p-lg", PLATE_CLASSES[ground], className)} style={style}>
        {children}
      </div>
    );
  }

  if (variant === "outline") {
    const outlineStyle: CSSProperties = { borderWidth: UI_BORDER_HAIRLINE, ...style };
    return (
      <div
        {...rest}
        data-variant="outline"
        className={cx("rounded-surface p-lg", OUTLINE_CLASSES[ground], className)}
        style={outlineStyle}
      >
        {children}
      </div>
    );
  }

  const mergedStyle: CSSProperties = { boxShadow: UI_ELEVATION_RAISED, ...style };
  return (
    <div {...rest} className={cx("rounded-control bg-surface-raised p-lg", className)} style={mergedStyle}>
      {children}
    </div>
  );
}
