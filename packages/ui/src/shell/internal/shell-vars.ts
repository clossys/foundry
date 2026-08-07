/**
 * Raw CSS custom-property reads for the @vespeneventures/tokens values the
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
 * default from @vespeneventures/tokens' `styles/tokens.css`), for the same
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
 * `SideNav`'s right edge, `Rail`'s left edge). Applied via inline
 * `border*Width`/`border*Color` rather than a Tailwind directional class
 * (`border-b`, `border-r`, ...): this package's own token-parity check
 * reads ANY `border-<suffix>` utility as a color-token reference (Tailwind
 * overloads the `border-` prefix for width, style, AND color — the same
 * reason `Menu.tsx`'s separator avoids `border-t`/`border-b` for its `<hr>`,
 * see the comment there), and `<suffix>` here would be `b`/`r`/`l`/`t` —
 * not a real token, a false positive the check would otherwise reject the
 * build over.
 *
 * The literal `1px` below, not a `var(--ui-border-hairline, 1px)` read:
 * that token's own PROPERTY NAME contains the substring `border-hairline`,
 * which the same token-parity check's class-name scan matches as if it
 * were a `border-hairline` Tailwind utility (an unrelated false positive —
 * a raw `var()` read's property name isn't a class name at all, but the
 * check's regex doesn't know that and finds the substring anyway). Hairline
 * width is, in practice, exactly as stable a value as `1px` for the reason
 * the token itself is `brandable: false` in `@vespeneventures/tokens` — a
 * brand can restyle every color here, never this.
 */
export const UI_BORDER_HAIRLINE = "1px";

/** Paired with `UI_BORDER_HAIRLINE` — see its own comment for why this isn't the `border-line-base` Tailwind class. */
export const UI_COLOR_LINE_BASE = "var(--color-line-base, oklch(0.8761 0 0))";

/**
 * Stacking for the skip-to-content link while focused. Needs to sit above
 * literally every other layer this package defines — including an open
 * `Menu`/`Select` popover (`--ui-z-modal`) — because a keyboard user can
 * tab to it, and land on it, at any point while other overlays are open.
 * `--ui-z-tooltip` is the highest member of the z-scale, so it's the
 * correct choice even though the skip link isn't a tooltip.
 */
export const UI_Z_SKIP_LINK = "var(--ui-z-tooltip, 80)";
