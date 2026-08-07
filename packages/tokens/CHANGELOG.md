# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - Unreleased

### Added

- **Dark mode.** `styles/tokens.css` now ships a dark value for every
  theme-dependent token, on top of the existing light default — additive,
  and light-mode behavior is unchanged except for the two contrast fixes
  below. The mechanism follows both signals, in both directions:

  ```css
  :root { /* light — unchanged */ }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { /* dark */ }
  }

  :root[data-theme="dark"] { /* dark */ }
  ```

  With no `data-theme` attribute, the OS/browser's `prefers-color-scheme`
  decides. `data-theme="dark"` forces dark even on a light OS.
  `data-theme="light"` forces light even on a dark OS — the
  `:not([data-theme="light"])` guard on the media-query block is what
  makes that last case work, by keeping the OS-dark rule from ever
  matching once light has been chosen explicitly. A consumer with a theme
  toggle stamps `data-theme` on `<html>`. `src/dark-mode-cascade.test.ts`
  simulates a real browser's cascade resolution against this package's
  actual selector text for all six {no attribute, `light`, `dark`} x
  {OS light, OS dark} combinations, rather than asserting the mechanism
  is correct by inspection.

- **The theme-invariant / theme-dependent split, made explicit and
  tested.** Only a token whose semantic ROLE changes with theme gets a
  dark value: colors, and `--ui-elevation-*` (a shadow reads as a color
  choice — `rgba(0, 0, 0, 0.10)` is a soft edge on a light surface and
  nothing at all on a dark one). Every structural scale — spacing,
  radius, z-index, motion duration, easing, breakpoint, font size,
  tracking, layout width, density, border width — is theme-invariant and
  does not appear in either dark block. `src/tokens.ts`'s
  `TokenDefinition` gained a `themeDependent: boolean` field recording
  this per token (35 tokens are `true`); `src/theme-parity.test.ts`
  parses the real dark blocks and asserts both directions against it —
  every theme-dependent token has a value in both, and no
  theme-invariant token appears in either.

  Two deliberate exceptions, both documented in `styles/tokens.css`'s
  header comment:
  - Color/elevation tokens that are themselves `var(--other-token, ...)`
    ALIASES (`--color-ink-on-accent`, `--color-overlay-surface`,
    `--color-overlay-border`, `--color-skeleton-fill`,
    `--ui-elevation-raised`) are `themeDependent: false` even though
    they're colors — their specified value never changes between
    themes, only the token they point to does, so they inherit their
    dark appearance automatically and a dark re-declaration would be a
    no-op at best.
  - `--color-neutral-*` (11 steps) **stays absolute** rather than
    inverting. This was a deliberate call — both directions are
    defensible, so it's written down rather than picked silently. The
    ramp is a raw swatch scale, not a semantic role (see the README's
    "What didn't translate cleanly" on why it intentionally shadows
    Tailwind's own `gray-*` naming): Tailwind's own default gray scale
    doesn't invert in dark mode either, and `--color-surface-*`/
    `--color-ink-*` are the tokens that already flip for anything that
    should read differently by theme.

- **`--color-surface-inverse` now flips polarity.** Previously "a dark
  plate within a light theme" unconditionally; in dark mode it becomes a
  **light** plate instead, and `--color-ink-on-inverse` flips with it
  (near-white ink becomes near-black ink) — the doc comment on both
  tokens in `styles/tokens.css` is updated to describe the flip rather
  than assert the old, now-incomplete, one-theme description.
  `--color-surface-inverse-raised` and `--color-line-on-inverse` flip the
  same way, for the same reason: they're defined relative to
  `--color-surface-inverse`, not to the ambient theme.

- **Status colors raise lightness in dark mode rather than reusing the
  light-mode value**, per the same "stay recognisable, meet contrast on
  a dark surface" principle used for ink and accent — e.g.
  `--color-status-danger` is a near-black grey in light mode (a
  legitimate role there: it needs to read dark against a light banner)
  and would be functionally invisible unchanged against a dark surface,
  so its dark value is substantially lighter while remaining the
  darkest of the four status roles, preserving the same relative
  ordering among success/warning/danger/info in both themes.

- **`brand-template.css` now has light AND dark binding blocks**, in the
  same cascade shape as `tokens.css` itself
  (`:root[data-brand-bound] { ... }`, then the media-query and explicit
  `[data-theme="dark"]` forms). Only the 33 tokens that are both
  brandable and theme-dependent (every `--color-surface-*`,
  `--color-ink-*` except the `-on-accent` alias, `--color-line-*`,
  `--color-accent-*`, and all 12 `--color-status-*` tokens) get dark
  slots — `--font-*` and `--radius-default` stay in the light block
  only, since a typeface or corner radius is a brand decision, not a
  theme one. **What a consumer must add:** any project that already has
  a `brand.css` started from the old template needs to add these two new
  blocks with real dark values before `data-theme="dark"` (or a
  dark-OS visitor) renders correctly — until then, a branded light theme
  paired with an unbranded, greyscale dark theme is exactly what ships,
  silently. `src/dark-mode-cascade.test.ts` verifies the specificity of
  the three brand selectors resolves the way this depends on:
  `:root[data-brand-bound][data-theme="dark"]` beats
  `:root[data-brand-bound]`, and the media-query form beats the plain
  brand binding but never matches (at any specificity) once
  `data-theme="light"` is set.

- A contrast test (`src/contrast.test.ts`) computing real WCAG contrast
  ratios — via a proper `oklch()` -> OKLab -> linear-sRGB -> relative-
  luminance conversion, not an approximation from the lightness channel
  — for the key ink-on-surface and status-text-on-tint pairs, in both
  themes, asserting AA (4.5:1) for body-level text and AA-large (3:1)
  for secondary/large text.

### Changed

- **Two light-mode contrast fixes**, found by writing the test above and
  proven failing before being touched (per this package's own rule:
  light-mode values don't change without a contrast test proving a
  failure first):
  - `--color-ink-muted`: `oklch(0.5658 0 0)` -> `oklch(0.54 0 0)`. Its own
    doc comment already promised "must hit WCAG AA on
    `--color-surface-base`"; measured, it was 4.17:1, not the 4.5:1 that
    promise requires. Darkened to the minimum change that clears AA with
    margin (4.64:1).
  - `--color-status-info-text`: `oklch(0.4748 0 0)` -> `oklch(0.52 0 0)`.
    Measured against `--color-status-info-tint`, it was 3.91:1, below the
    4.5:1 the other three status `-text`/`-tint` pairs already clear.
    Darkened to the minimum change that clears AA with margin (4.75:1).

  Both are small, targeted value changes — no token was renamed, no other
  value moved, and every other token's light-mode value is byte-identical
  to 0.2.0.

## [0.2.0] - Unreleased

### Changed

- **BREAKING: renamed `--radius-s` to `--radius-subtle`.** `--radius-s`
  collided with Tailwind v4's own builtin `rounded-s` utility — the
  logical "start side" corner radius, part of Tailwind's reserved
  radius-direction vocabulary (`s`/`e`/`t`/`r`/`b`/`l` and their two-letter
  logical/physical corner combinations, plus `none`/`full`). Because
  `--radius-*` is one of the namespaces this package intentionally maps
  onto Tailwind's own `@theme` prefix (see the README's "Naming
  convention"), declaring `--radius-s` caused `theme.css` to generate a
  `.rounded-s` utility that collided with Tailwind's builtin of the same
  name. Verified against a real Tailwind v4.3.3 compile, the two rules
  merged onto one selector instead of one replacing the other:

  ```css
  .rounded-s {
    border-radius: var(--radius-s, 2px);      /* ours */
    border-start-start-radius: 0.25rem;        /* Tailwind's builtin */
    border-end-start-radius: 0.25rem;          /* Tailwind's builtin */
  }
  ```

  A consumer writing `rounded-s` expecting a uniform 2px radius instead got
  2px on two corners and Tailwind's default `0.25rem` on the other two —
  visually broken, and invisible unless you read the compiled CSS.
  `--radius-s` was also the only token in this package named after its
  raw value (`s` for "small") rather than a semantic role, which violates
  this package's own admission test ("Names describe ROLES, not values" —
  see tokens.css's header comment). `--radius-subtle` fixes both: it is
  not a Tailwind reserved word (verified: `rounded-subtle` compiles to
  nothing without this package's own `@theme` entry, and to a single clean
  `border-radius: var(--radius-subtle, 2px)` with it), and it names the
  role the token actually plays. The value (`2px`) and its position in the
  scale (between `--radius-sharp` and `--radius-default`) are unchanged.

  **Migration:** anywhere you wrote `rounded-s` (Tailwind) or
  `var(--radius-s)` (plain CSS), switch to `rounded-subtle` /
  `var(--radius-subtle)`.

### Added

- A test (`src/tailwind-builtin-collision.test.ts`) asserting no token in
  a Tailwind-namespaced family (`--radius-*`, `--spacing-*`, `--text-*`,
  `--font-*`) uses a suffix Tailwind itself reserves in that namespace —
  the general case of the `--radius-s` defect above. The reserved-suffix
  lists were verified against a real `@tailwindcss/cli@4.3.3` compile,
  not just Tailwind's docs; see the test file's header comment for the
  compiled-CSS evidence of both failure modes (a split-property collision,
  as with `--radius-s`, and a silent full shadow, as with a hypothetical
  `--font-thin`).

## [0.1.0] - Unreleased

### Added

- Initial release: 128 design tokens across 24 families (surface, ink,
  line, accent, status, neutral, overlay, skeleton, text, font, tracking,
  spacing, radius, easing, breakpoint, width, layout, density, border,
  elevation, ring, duration, z, alpha), shipped as CSS custom properties
  (`styles/tokens.css`), an optional Tailwind v4 `@theme` wiring
  (`styles/theme.css`), a brand-binding template (`styles/brand-template.css`),
  and typed JS/TS values (`.`).
- Three-layer contract: primitives (this package) → brand binding (a
  consumer's own file, started from `brand-template.css`) → consumer
  extensions.
