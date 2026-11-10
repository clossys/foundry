import { Icon } from "./preview-runtime/components/icon/icon.js";
import { AlertTriangle, CheckCircle, Info, XCircle } from "../icons/index.js";
import { Minus } from "../icons/Minus.js";
import type { IconNode } from "../icons/types.js";
import type { GlyphBindings } from "./glyph-context.js";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./internal/cx.js";
import { Status, StatusLabel, type StatusProps } from "./partners/kibo-ui/status.js";

export type StatusMarkTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusMarkProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** The state's tone. Colour only repeats what the glyph and the text already say. */
  tone: StatusMarkTone;
  /** Server-safe asset bindings; each replacement uses the standard 24-unit grid. */
  glyphs?: GlyphBindings;
  /** The neutral dash has no asset leaf; replace it explicitly on the 24-unit grid. */
  neutralGlyph?: IconNode;
  /**
   * Required. The state in words ("Received", "Outside limit"). The text
   * always carries the meaning; the glyph is decoration.
   */
  children: ReactNode;
}

/** Kibo UI's status vocabulary per tone; neutral carries no indicator colour. */
const KIBO_STATUS: Record<StatusMarkTone, StatusProps["status"]> = {
  success: "online",
  warning: "degraded",
  danger: "offline",
  info: "maintenance",
  neutral: "neutral",
};

/** The Lucide glyph per tone, exposed as `data-shape` on the mark. */
type StatusMarkShape = "circle-check" | "triangle-alert" | "circle-x" | "info" | "minus";

const SHAPES: Record<StatusMarkTone, StatusMarkShape> = {
  success: "circle-check",
  warning: "triangle-alert",
  danger: "circle-x",
  info: "info",
  neutral: "minus",
};

// Kibo UI's status indicator is a colour-only dot, so each tone carries its own
// Lucide glyph instead: the outline carries the tone when colour cannot (a
// greyscale brand, a print, a colour-blind reader).
const SHAPE_GLYPHS: Record<StatusMarkShape, IconNode> = {
  "circle-check": CheckCircle,
  "triangle-alert": AlertTriangle,
  "circle-x": XCircle,
  info: Info,
  minus: Minus,
};

const MARK_CLASSES: Record<StatusMarkTone, string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  danger: "text-status-danger",
  info: "text-status-info",
  neutral: "text-ink-muted",
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
 * One data state inside a row, a table cell or a panel header: Kibo UI's
 * `Status` badge (MIT) holding a tone glyph and a label.
 *
 * Each tone has its own Lucide glyph as well as its own colour (success a
 * circle check, warning a triangle alert, danger a circle x, info an info
 * circle, neutral a dash), so the states stay distinct in a greyscale brand
 * and for a reader who cannot tell the colours apart. The glyph is
 * `aria-hidden`; the label is ordinary text in the tone's `status-*-text`
 * colour on the outline badge (no tint behind it), which is contrast-checked
 * against the raised surface in both themes. Not interactive and uses no
 * hooks, so it is server-safe (re-exported from `components/server.ts`).
 */
export function StatusMark({ tone, glyphs, neutralGlyph, className, children, ...rest }: StatusMarkProps) {
  const glyph = tone === "neutral" ? neutralGlyph : glyphs?.[ASSETS[tone]];
  return (
    <Status
      {...rest}
      status={KIBO_STATUS[tone]}
      variant="outline"
      data-tone={tone}
      className={cx("inline-flex text-body-s font-body", className)}
    >
      <Icon
        glyph={glyph ?? SHAPE_GLYPHS[SHAPES[tone]]}
        decorative
        focusable="false"
        data-part="mark"
        data-shape={SHAPES[tone]}
        className={cx("inline-block shrink-0", MARK_CLASSES[tone])}
      />
      <StatusLabel data-part="label" className={TEXT_CLASSES[tone]}>{children}</StatusLabel>
    </Status>
  );
}
