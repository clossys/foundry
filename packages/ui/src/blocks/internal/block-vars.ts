/**
 * Raw CSS custom-property reads for the token-layer values `blocks/` needs
 * that have no Tailwind utility namespace — the same "case 2" tokens
 * `../../atoms/internal/ui-vars.ts` and `../../shell/internal/shell-vars.ts`
 * already document (no `@theme` namespace exists for either width or
 * z-index in Tailwind v4). Kept in its own file rather than added to either
 * of those, for the same reason `shell-vars.ts` stays separate from
 * `atoms/internal/ui-vars.ts`: this name is specific to laying out a block
 * (`ArticleBody`'s own content-column width) and has no reason to be
 * reachable from `atoms/` or `shell/` — neither an atom nor a piece of
 * persistent chrome ever constrains a prose column.
 *
 * Carries an explicit fallback (the token's own shipped default from this
 * package's `styles/tokens.css`), for the same reason every other file in
 * this family does: a consumer who has this package but hasn't wired up
 * tokens' CSS yet still gets a legible, if unbranded, result — a
 * reasonably narrow reading measure — instead of `var()` silently
 * resolving to nothing.
 */

/** Max width `ArticleBody` centers its content within — a reasonable reading measure for long-form text. */
export const UI_WIDTH_PROSE_MAX = "var(--ui-width-prose-max, 48rem)";
