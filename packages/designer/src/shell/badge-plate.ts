/**
 * The shared plate's geometry, in one place: a rounded square drawn behind
 * a `Brandmark`'s image. `Brandmark` derives its CSS from the two shares
 * below and `badgePlatePath` derives the same square as SVG path data for a
 * consumer that draws the plate itself, so the two cannot drift apart.
 *
 * Server-safe and dependency-free: no React, no DOM.
 */

/** The corner radius as a fraction of the plate's side (7/32). */
export const BADGE_RADIUS_SHARE = 7 / 32;

/** The gap between the plate's edge and the image, as a fraction of the side, on each side. */
export const BADGE_INSET_SHARE = 0.18;

/** Rounds to 3 decimals and writes negative zero as `0`. */
function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded === 0 ? 0 : rounded);
}

/**
 * The path of a rounded square from (0, 0) to (`size`, `size`), with corner
 * radius `size * BADGE_RADIUS_SHARE` (each number rounded to 3 decimals).
 * Throws a `TypeError` for a non-number and a `RangeError` for a non-finite
 * or non-positive `size`; the message names `size` and never repeats its value.
 */
export function badgePlatePath(size: number): string {
  if (typeof size !== "number") {
    throw new TypeError("badgePlatePath: `size` must be a number.");
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError("badgePlatePath: `size` must be a finite number greater than zero.");
  }
  const r = num(size * BADGE_RADIUS_SHARE);
  const far = num(size - size * BADGE_RADIUS_SHARE);
  const s = num(size);
  return `M${r} 0H${far}A${r} ${r} 0 0 1 ${s} ${r}V${far}A${r} ${r} 0 0 1 ${far} ${s}H${r}A${r} ${r} 0 0 1 0 ${far}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}
