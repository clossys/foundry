/**
 * Shell-path bindings that stay importable from the shell layer: the
 * skip-link layer and the shared brandmark scale. The frame layout values
 * (region widths, measures, stacking layers, the hairline edge) are named
 * utilities in `styles/theme-keys.css`, which read the `--ui-*` token with
 * its `styles/tokens.css` default, so no shell source reads a layout token
 * or carries a fallback length of its own.
 */

/**
 * Stacking for the skip-to-content link while focused. Needs to sit above
 * literally every other layer this package defines — including an open
 * `Menu`/`Select` popover (`--ui-z-modal`) — because a keyboard user can
 * tab to it, and land on it, at any point while other overlays are open.
 * The dedicated skip-link layer sits above progress and every overlay.
 */
export { UI_Z_SKIP_LINK } from "../../tokens/tokens.js";

/** Shared brandmark bindings retain their original shell import path. */
export {
  UI_BRANDMARK_HEIGHT_SM,
  UI_BRANDMARK_HEIGHT_MD,
  UI_BRANDMARK_HEIGHT_LG,
  UI_BRANDMARK_GAP_SM,
  UI_BRANDMARK_GAP_MD,
  UI_BRANDMARK_GAP_LG,
  BRANDMARK_WORDMARK_SIZE_RATIO,
  UI_BRANDMARK_WORDMARK_SIZE_SM,
  UI_BRANDMARK_WORDMARK_SIZE_MD,
  UI_BRANDMARK_WORDMARK_SIZE_LG,
} from "../../internal/brandmark.js";
