/**
 * Raw CSS custom-property reads for the handful of @vespeneventures/tokens
 * values this layer needs that have no Tailwind utility namespace — the
 * same "case 2" convention `atoms/internal/ui-vars.ts` and
 * `shell/internal/shell-vars.ts` both already follow (see either file's own
 * header comment for the full naming rule). Kept as `views`' own file
 * rather than importing one of those two: `views` is not permitted to
 * import from `shell` (see `ladder.test.ts` — `shell` provides the slot a
 * view fills, so a view reaching into it would be exactly backwards), and
 * `atoms/internal/ui-vars.ts` has no reason to carry a width constant no
 * atom uses.
 *
 * Every read below carries an explicit fallback (the token's own shipped
 * default from @vespeneventures/tokens' `styles/tokens.css`), for the same
 * reason the other two files' reads do: a consumer who has this package but
 * hasn't wired up tokens' CSS yet still gets a legible, if unbranded,
 * result instead of `var()` silently resolving to nothing.
 */

/**
 * Max width for `ErrorView`'s collapsible technical-details block — long
 * enough to read comfortably, short enough that a stack trace's own line
 * length doesn't force the whole page wider. There is no Tailwind `@theme`
 * namespace for width (see @vespeneventures/tokens' naming rule — width is
 * a "case 2", `--ui-`-prefixed token for exactly that reason, the same as
 * `--ui-width-content-max` `Shell.Main` reads), so this is a raw `var()`
 * read applied via inline `style`, not a Tailwind class.
 */
export const UI_WIDTH_PROSE_MAX = "var(--ui-width-prose-max, 48rem)";
