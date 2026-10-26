import { Icon } from "./Icon.js";
import type { IconNode } from "../icons/types.js";
import type { GlyphBindings } from "./glyph-context.js";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./internal/cx.js";

export type StatusMarkTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusMarkProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** The state's tone. Colour only repeats what the text already says. */
  tone: StatusMarkTone;
  /** Server-safe asset bindings; each replacement uses the standard 24-unit grid. */
  glyphs?: GlyphBindings;
  /** The neutral dash has no asset leaf; replace it explicitly on the 24-unit grid. */
  neutralGlyph?: IconNode;
  /**
   * Required. The state in words ("Received", "Outside limit"). The text
   * always carries the meaning; the mark is decoration.
   */
  children: ReactNode;
}

const MARK_CLASSES: Record<StatusMarkTone, string> = {
  success: "fill-status-success",
  warning: "fill-status-warning",
  danger: "fill-status-danger",
  info: "fill-status-info",
  neutral: "fill-ink-muted",
};

/** The mark's shape per tone, exposed as `data-shape` on the mark. */
type StatusMarkShape = "circle" | "triangle" | "diamond" | "open-circle" | "dash";

const SHAPES: Record<StatusMarkTone, StatusMarkShape> = {
  success: "circle",
  warning: "triangle",
  danger: "diamond",
  info: "open-circle",
  neutral: "dash",
};

// Drawn in a 10x10 box as fills only (the open circle is an even-odd ring),
// so the tone's one `fill-*` class colours every shape. The geometry carries
// the tone when colour cannot: a greyscale brand, a print, a colour-blind
// reader.
const SHAPE_PATHS: Record<StatusMarkShape, IconNode> = {
  circle: [["circle", { cx: "5", cy: "5", r: "4.5" }]],
  triangle: [["path", { d: "M5 0.5 9.75 9.25H0.25Z" }]],
  diamond: [["path", { d: "M5 0 10 5 5 10 0 5Z" }]],
  "open-circle": [["path", { fillRule: "evenodd", d: "M5 0.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9ZM5 2a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z" }]],
  dash: [["rect", { x: "1", y: "4", width: "8", height: "2", rx: "1" }]],
};
const ASSETS = {
  success: "assets.icon-success",
  warning: "assets.icon-warning",
  danger: "assets.icon-danger",
  info: "assets.icon-info",
} as const;

const TEXT_CLASSES: Record<StatusMarkTone, string> = {
  success: "text-status-success-text",
  warning: "text-status-warning-text",
  danger: "text-status-danger-text",
  info: "text-status-info-text",
  neutral: "text-ink-secondary",
};

/**
 * A small tone mark followed by a label: one data state inside a row,
 * a table cell or a panel header. Lighter than `Badge` (no pill fill), for
 * places where several states sit close together.
 *
 * Each tone has its own shape as well as its own colour (success a filled
 * circle, warning a triangle, danger a diamond, info a ring, neutral a
 * dash), so the states stay distinct in a greyscale brand and for a reader
 * who cannot tell the colours apart. The mark is `aria-hidden`; the label is ordinary text in the tone's
 * `status-*-text` colour, which is contrast-checked against the raised
 * surface in both themes. Not interactive, renders glyph data through Icon and uses
 * no hooks, so it is server-safe (re-exported from `components/server.ts`).
 */
export function StatusMark({ tone, glyphs, neutralGlyph, className, children, ...rest }: StatusMarkProps) {
  const glyph = tone === "neutral" ? neutralGlyph : glyphs?.[ASSETS[tone]];
  return (
    <span
      {...rest}
      data-tone={tone}
      className={cx("inline-flex items-center gap-xs text-body-s font-body", TEXT_CLASSES[tone], className)}
    >
      <Icon
        glyph={glyph ?? SHAPE_PATHS[SHAPES[tone]]}
        decorative
        focusable="false"
        viewBox={glyph ? "0 0 24 24" : "0 0 10 10"}
        data-part="mark"
        data-shape={SHAPES[tone]}
        className={cx("inline-block shrink-0", MARK_CLASSES[tone])}
        style={{ width: "10px", height: "10px", ...(glyph ? { fill: "none" } : { stroke: "none" }) }}
      />
      <span>{children}</span>
    </span>
  );
}
