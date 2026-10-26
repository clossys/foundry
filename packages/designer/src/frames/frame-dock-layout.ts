import { TOKENS } from "../tokens/index.js";

export interface FrameDockBounds {
  min?: number;
  max?: number;
  defaultValue?: number;
}
export const FRAME_DOCK_DEFAULTS = {
  min: Number.parseFloat(TOKENS["--ui-layout-dock-min-block"]!.value),
  defaultValue: Number.parseFloat(TOKENS["--ui-layout-dock-default-block"]!.value),
  max: Number.parseFloat(TOKENS["--ui-layout-dock-max-block"]!.value),
} as const;
/** Frames shorter than the tablet breakpoint show one single-line notice so the stage keeps its height. */
export const FRAME_NOTICE_COMPACT_BLOCK = Number.parseFloat(TOKENS["--breakpoint-tablet"]!.value);
/** The measured capacity excludes the actual header, notices, strip and dock border. */
export function frameDockGeometry(available: number | undefined, bounds: FrameDockBounds = {}, requested?: number) {
  const min = bounds.min ?? FRAME_DOCK_DEFAULTS.min;
  const max = bounds.max ?? FRAME_DOCK_DEFAULTS.max;
  const initial = bounds.defaultValue ?? FRAME_DOCK_DEFAULTS.defaultValue;
  if (![min, max, initial, requested ?? initial].every(value => Number.isFinite(value) && value >= 0) || min > max || (available !== undefined && (!Number.isFinite(available) || available < 0))) {
    throw new TypeError("FrameDock: finite nonnegative ordered height bounds are required.");
  }
  const maximum = Math.min(max, available ?? max);
  const minimum = Math.min(min, maximum);
  const clamp = (value: number) => Math.min(maximum, Math.max(minimum, value));
  return { min: minimum, max: maximum, defaultValue: clamp(initial), value: clamp(requested ?? initial) };
}
