/** Shared identity geometry and CSS bindings. Dependency-free and server-safe. */

/** The corner radius as a fraction of the plate's side (7/32). */
export const BADGE_RADIUS_SHARE = 7 / 32;

/** Inset on each side as a fraction of the plate's side. */
export const BADGE_INSET_SHARE = 0.18;

/**
 * `Brandmark`'s height per size step, and the gap between its mark and a
 * lockup's wordmark. Same fallback-carrying convention as everything above
 * (each fallback is the token's own shipped default in `styles/tokens.css`).
 * Heights are 24/36/48px; each gap is that height x the identity kit's 8/48
 * lockup gap ratio (4/6/8px), kept as its own token so a brand can retune
 * lockup spacing without resizing the mark.
 */
export const UI_BRANDMARK_HEIGHT_SM = "var(--ui-brandmark-height-sm, 24px)";
export const UI_BRANDMARK_HEIGHT_MD = "var(--ui-brandmark-height-md, 36px)";
export const UI_BRANDMARK_HEIGHT_LG = "var(--ui-brandmark-height-lg, 48px)";
export const UI_BRANDMARK_GAP_SM = "var(--ui-brandmark-gap-sm, 4px)";
export const UI_BRANDMARK_GAP_MD = "var(--ui-brandmark-gap-md, 6px)";
export const UI_BRANDMARK_GAP_LG = "var(--ui-brandmark-gap-lg, 8px)";

/**
 * A lockup wordmark's font-size as a fraction of the mark's height (22/48,
 * the identity kit's lockup wordmark-size ratio). Defined here rather than
 * imported from `../../tokens/identity-kit.js`: no component, block, or shell
 * source file imports from `tokens/` today (only tests do), so importing it
 * would open a new dependency direction for one number. The component's test
 * asserts this equals the identity kit's own ratio.
 */
export const BRANDMARK_WORDMARK_SIZE_RATIO = 22 / 48;

/** The wordmark font-size for each size step: the mark's height token x the ratio above. */
export const UI_BRANDMARK_WORDMARK_SIZE_SM = `calc(${UI_BRANDMARK_HEIGHT_SM} * ${BRANDMARK_WORDMARK_SIZE_RATIO})`;
export const UI_BRANDMARK_WORDMARK_SIZE_MD = `calc(${UI_BRANDMARK_HEIGHT_MD} * ${BRANDMARK_WORDMARK_SIZE_RATIO})`;
export const UI_BRANDMARK_WORDMARK_SIZE_LG = `calc(${UI_BRANDMARK_HEIGHT_LG} * ${BRANDMARK_WORDMARK_SIZE_RATIO})`;
