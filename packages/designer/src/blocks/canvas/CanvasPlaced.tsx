"use client";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../../components/internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "../../components/internal/ui-vars.js";
import type { CanvasRect } from "./models.js";

export interface CanvasPlacedProps extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "children"> {
  /** The box, in untransformed world pixels. */
  rect: CanvasRect;
  /** Drops the box to the disabled alpha (an unlit usage neighbour). */
  dimmed?: boolean;
  /** Paints the focus ring around the box (an arrival or selection marker). */
  ring?: boolean;
  children?: ReactNode;
}

/**
 * Places world content at a world rectangle inside a positioned `CanvasSurface`
 * world. This is the one owner of positioned geometry for hosts above
 * Components (the system canvas places every board, line and cell with it), so
 * those hosts keep no inline style of their own.
 */
export function CanvasPlaced({ rect, dimmed = false, ring = false, className, children, ...rest }: CanvasPlacedProps) {
  return <div {...rest} data-canvas-placed="" className={cx("absolute box-border", className)}
    /* Named inline-style exception: world geometry comes from the host's layout model, in world pixels. */
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, opacity: dimmed ? UI_ALPHA_DISABLED : undefined, boxShadow: ring ? UI_RING_FOCUS : undefined }}>
    {children}
  </div>;
}

export type CanvasChipTone = "neutral" | "success" | "warning" | "danger" | "info";
export interface CanvasChip { readonly id: string; readonly rect: CanvasRect; readonly tone?: CanvasChipTone; readonly dimmed?: boolean }

const CHIP_FILL: Readonly<Record<CanvasChipTone, string>> = {
  neutral: "fill-ink-muted", success: "fill-status-success", warning: "fill-status-warning", danger: "fill-status-danger", info: "fill-status-info",
};

/**
 * The far tier of a whole board as one cheap drawing: one SVG, one rectangle
 * per cell, filled by status tone. A board of far cells mounts this and no
 * per-cell elements.
 */
export function CanvasChipGrid({ rect, chips, className, ...rest }: { rect: CanvasRect; chips: readonly CanvasChip[]; className?: string } & Omit<HTMLAttributes<SVGSVGElement>, "style" | "children">) {
  return <svg {...rest} data-canvas-chips="" aria-hidden="true" focusable="false" className={cx("pointer-events-none absolute", className)}
    viewBox={`${rect.x} ${rect.y} ${rect.width} ${rect.height}`}
    /* Named inline-style exception: the drawing covers the board's world rectangle. */
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
    {chips.map(chip => <rect key={chip.id} data-canvas-chip={chip.id} x={chip.rect.x} y={chip.rect.y} width={chip.rect.width} height={chip.rect.height}
      className={CHIP_FILL[chip.tone ?? "neutral"]} style={chip.dimmed ? { opacity: UI_ALPHA_DISABLED } : undefined} />)}
  </svg>;
}
