/**
 * Raw CSS custom-property reads for the token-layer values the
 * shell layer needs that have no Tailwind utility namespace — the same
 * "case 2" tokens `../../atoms/internal/ui-vars.ts` documents (z-index,
 * layout widths: no `@theme` namespace exists for either, per that
 * package's README naming rule). Kept in a separate file from
 * `atoms/internal/ui-vars.ts` rather than added to it, even though the
 * fallback-value convention is identical, because these names are specific
 * to laying out the persistent frame (sidebar/aside widths, shell/aside/
 * toast stacking) and have no reason to be reachable from `atoms/` — an
 * atom never renders a sidebar or a toast viewport.
 *
 * Every read below carries an explicit fallback (the token's own shipped
 * default from this package's `styles/tokens.css`), for the same
 * reason `ui-vars.ts` does: a consumer who has this package but hasn't
 * wired up tokens' CSS yet still gets a legible, if unbranded, shell —
 * correctly sized regions and correctly ordered stacking — instead of
 * `var()` silently resolving to nothing.
 */

// `--ui-layout-sidebar-w` and `--ui-layout-sidebar-rail-w` (`Shell.SideNav`'s
// full and collapsed widths) are NOT re-exported as constants here, unlike
// every other value in this file: they need a `tablet:` RESPONSIVE variant
// (full width from the `tablet` breakpoint up, the rail width below it),
// which only works as a literal Tailwind arbitrary-value class
// (`w-[var(--ui-layout-sidebar-w,256px)]`) — Tailwind's build-time scanner
// reads source text for exactly that shape and cannot see through a JS
// identifier standing in for it. `Shell.tsx` writes both literally for that
// reason; see the comment on `ShellSideNav` there.

/** The optional context `Rail` (aside), shown from the `desktop` breakpoint up. */
export const UI_LAYOUT_ASIDE_W = "var(--ui-layout-aside-w, 320px)";

/** Max width `Shell.Main`'s content is centered within. */
export const UI_WIDTH_CONTENT_MAX = "var(--ui-width-content-max, 64rem)";

/** Fluid horizontal inset applied to the shell's full-bleed regions. */
export const UI_WIDTH_PAGE_PADDING_X = "var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))";

/**
 * Stacking for the persistent header/side navigation/footer — the shell
 * "chrome" proper. Sits above ordinary in-page sticky content
 * (`--ui-z-sticky`), below the `Rail`'s own layer and everything transient
 * (notices, modals, toasts, the command palette, tooltips).
 */
export const UI_Z_SHELL = "var(--ui-z-shell, 20)";

/**
 * Stacking for `Shell.Rail` — one layer above the rest of shell chrome, per
 * the z-scale's own ordering (`--ui-z-shell` then `--ui-z-aside`). Mirrors
 * `atoms/internal/ui-vars.ts`' note on `UI_Z_POPOVER`: this package's
 * z-index tokens are already listed in stacking order, so "the aside sits
 * above the rest of the frame" reads directly off `tokens.ts` rather than
 * being asserted here.
 */
export const UI_Z_ASIDE = "var(--ui-z-aside, 30)";

/** Stacking for the toast viewport — above modals, below the tooltip layer. */
export const UI_Z_TOAST = "var(--ui-z-toast, 60)";

/**
 * Hairline divider width, shared by every single-edge border `Shell`'s
 * chrome regions draw (`Header`'s bottom edge, `Footer`'s top edge,
 * `SideNav`'s right edge, `Rail`'s left edge). Border WIDTH stays a raw
 * `var()` read applied via inline style rather than a Tailwind class: there
 * is no `@theme` namespace for border-width in Tailwind v4 (see
 * this package's token-layer naming rule — border width is a "case 2",
 * `--ui-`-prefixed token for exactly that reason), so a Tailwind class can
 * only ever reach Tailwind's own hardcoded `1px`, never this token's actual
 * value. Border STYLE and COLOR, unlike width, map onto real token families
 * (`--color-line-base`) and are applied as ordinary Tailwind classes
 * (`border-b border-line-base`, etc.) on each region in `Shell.tsx`.
 *
 * This used to be hardcoded to the literal `"1px"` instead of reading the
 * token: `--ui-border-hairline`'s own PROPERTY NAME contains the substring
 * `border-hairline`, which `token-parity.test.ts`'s class-name scan used to
 * match as if it were a `border-hairline` Tailwind utility — a false
 * positive, since a raw `var()` read's property name isn't a class name at
 * all. That check now blanks out custom-property names before scanning for
 * classes (see `blankCustomProperties` there), so the real token read is
 * restored here.
 */
export const UI_BORDER_HAIRLINE = "var(--ui-border-hairline, 1px)";

/**
 * Stacking for the skip-to-content link while focused. Needs to sit above
 * literally every other layer this package defines — including an open
 * `Menu`/`Select` popover (`--ui-z-modal`) — because a keyboard user can
 * tab to it, and land on it, at any point while other overlays are open.
 * `--ui-z-tooltip` is the highest member of the z-scale, so it's the
 * correct choice even though the skip link isn't a tooltip.
 */
export const UI_Z_SKIP_LINK = "var(--ui-z-tooltip, 80)";
