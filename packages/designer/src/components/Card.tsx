import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "./internal/cx.js";
import { UI_BORDER_PANEL, UI_ELEVATION_RAISED } from "./internal/ui-vars.js";

/**
 * - `"raised"` (default): the original card, unchanged — raised fill,
 *   `rounded-control`, the hairline elevation shadow.
 * - `"plate"`: a content plate. It reads as the OTHER ground from the
 *   section it sits on (see `ground`), with `rounded-panel`, no stroke
 *   and no shadow — a card made by a change of ground, not by a box.
 * - `"outline"`: a product panel. Raised fill, one panel edge,
 *   `rounded-panel`, never a shadow of its own.
 *
 * Plate and outline read the panel identity tokens: `--radius-panel` for
 * the corner, and (outline) `--ui-border-panel` and `--color-line-panel`
 * for the edge. Each defaults to today's surface radius and hairline in the
 * base line, so a brand changes panels in one place.
 */
export type CardVariant = "raised" | "plate" | "outline";

/**
 * The ground of the section a card sits on. An component cannot see its
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
  base: "border border-line-panel bg-surface-raised",
  sunken: "border border-line-panel bg-surface-raised",
  inverse: "border border-line-on-inverse bg-surface-inverse-raised",
};

/**
 * A content surface. Not interactive and does not compose another component —
 * plain markup, no react-aria-components primitive needed, unlike
 * `Button` and `TextField` (see this package's README). Server-safe: no
 * hooks, so it is re-exported from `components/server.ts`.
 */
export function Card({ variant = "raised", ground = "base", className, style, children, ...rest }: CardProps) {
  if (variant === "plate") {
    return (
      <div {...rest} data-variant="plate" className={cx("rounded-panel p-lg", PLATE_CLASSES[ground], className)} style={style}>
        {children}
      </div>
    );
  }

  if (variant === "outline") {
    const outlineStyle: CSSProperties = { borderWidth: UI_BORDER_PANEL, ...style };
    return (
      <div
        {...rest}
        data-variant="outline"
        className={cx("rounded-panel p-lg", OUTLINE_CLASSES[ground], className)}
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
