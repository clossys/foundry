/**
 * Raw CSS custom-property reads for the token-layer values `blocks/` needs
 * that have no Tailwind utility namespace — the same "case 2" tokens
 * `../../atoms/internal/ui-vars.ts` and `../../shell/internal/shell-vars.ts`
 * already document (no `@theme` namespace exists for either width or
 * z-index in Tailwind v4). Kept in its own file rather than added to either
 * of those, for the same reason `shell-vars.ts` stays separate from
 * `atoms/internal/ui-vars.ts`: this name is specific to laying out a block
 * (`SectionFrame`'s measure column, formerly `ArticleBody`'s own width)
 * and has no reason to be reachable from `atoms/` or `shell/` — neither an
 * atom nor a piece of persistent chrome ever constrains a marketing column.
 *
 * Carries an explicit fallback (the token's own shipped default from this
 * package's `styles/tokens.css`), for the same reason every other file in
 * this family does: a consumer who has this package but hasn't wired up
 * tokens' CSS yet still gets a legible, if unbranded, result — instead of
 * `var()` silently resolving to nothing.
 */

/** Max width for long-form prose inside a `SectionFrame` with `measure="prose"`. */
export const UI_WIDTH_PROSE_MAX = "var(--ui-width-prose-max, 48rem)";

/** Tailwind classes every display-sized marketing heading should carry (measure + brand display signature). */
export const DISPLAY_HEADING_CLASS = "text-display-l font-display max-w-display";

/** Default marketing column width — the same cap `Shell.Main` centers on. */
export const UI_WIDTH_CONTENT_MAX = "var(--ui-width-content-max, 64rem)";

/** Wider marketing band for stat rows and multi-column compositions. */
export const UI_WIDTH_WIDE_MAX = "var(--ui-width-wide-max, 72rem)";

/** Horizontal inset for full-bleed marketing sections — matches shell chrome. */
export const UI_WIDTH_PAGE_PADDING_X = "var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))";

export type SectionMeasure = "content" | "wide" | "prose";

export const SECTION_MEASURE_MAX: Readonly<Record<SectionMeasure, string>> = {
  content: UI_WIDTH_CONTENT_MAX,
  wide: UI_WIDTH_WIDE_MAX,
  prose: UI_WIDTH_PROSE_MAX,
};

/** Marker attribute `SectionFrame` sets so gates can prove framed composition. */
export const SECTION_FRAME_DATA_ATTR = "data-designer-section-frame";
