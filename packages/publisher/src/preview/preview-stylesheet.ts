import { fileURLToPath } from "node:url";

/**
 * The utility stylesheet every preview page links, between Designer's
 * `tokens.css` and the brand file: a copy of this package's
 * `styles/preview.css`. Its generator, `scripts/preview-css.mjs`, is available
 * in a source checkout and does not ship with this package. The stylesheet holds
 * Tailwind's preflight plus one compile of Designer's component classes and
 * every class Publisher's own views emit, so the preview renders Publisher's
 * band rhythm and grids the way a consumer's own Tailwind build would.
 * Designer's `compiled.css` alone covers only Designer's classes.
 */
export const PREVIEW_UTILITIES_BASENAME = "publisher-preview.css";

/** Absolute path to `styles/preview.css`; resolves the same from `src/preview` and `dist/preview`. */
export function previewUtilitiesSourcePath(): string {
  return fileURLToPath(new URL("../../styles/preview.css", import.meta.url));
}
