/**
 * `Frame` -> an absolutely-positioned box, as a percentage of its
 * containing block — the one place geometry actually survives in this
 * package (see `renderPrintDocument.ts`'s own doc comment, "Geometry
 * SURVIVES here"). Built entirely on `@vespeneventures/compose`'s own
 * `frameToPercent` — this file only formats its output for CSS and never
 * recomputes the fraction -> percentage arithmetic itself.
 */

import { frameToPercent } from "@vespeneventures/compose";
import type { Frame } from "@vespeneventures/compose";

/**
 * Rounds a raw percentage (0..100, straight out of `frameToPercent`) to 4
 * decimal places and formats it without trailing zeros — the real
 * floating-point result of `(1 / 3) * 100` (`33.33333333333333`) becomes
 * `"33.3333"`, and `50` stays `"50"`. 4 decimal places is far past what any
 * print output needs positionally (a ten-thousandth of a page's width) and
 * exists only to absorb float noise, never to round away real precision a
 * caller supplied.
 */
export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000;
  return String(rounded === 0 ? 0 : rounded);
}

/** `left`/`top`/`width`/`height` percentages (as ready-to-emit strings, no `%` unit) for `frame`, positioned within its containing block. */
export function frameToPercentStrings(frame: Frame): { left: string; top: string; width: string; height: string } {
  const rect = frameToPercent(frame);
  return {
    left: formatPercent(rect.x),
    top: formatPercent(rect.y),
    width: formatPercent(rect.w),
    height: formatPercent(rect.h),
  };
}
