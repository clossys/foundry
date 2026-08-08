# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.6.0] - Unreleased

### Added

- **`checkBrandCoverage` — this package is now self-closing, the same shape
  every sibling contract package in this ecosystem already ships.**
  Previously this package shipped a vocabulary (`TOKENS`) and a template
  (`styles/brand-template.css`) with no way for a consumer to check whether
  their OWN real `brand.css` actually filled the template in correctly.
  `checkBrandCoverage(declarations, options?)` is a pure function taking
  already-parsed custom-property declarations and reporting: every
  `brandable: true` slot with no real (non-empty) declared value
  (`uncovered-brandable-slot`), every declaration naming a slot absent from
  `TOKENS` — almost always a typo (`unknown-slot`), and every declaration
  targeting a `brandable: false` structural slot — the same rule
  `@vespeneventures/render`'s `flattenTokens` already enforces by throwing
  (`non-brandable-override`), plus an explicit `unchecked` list for any
  declaration key it cannot even classify. `ok` is `true` only when
  something was actually checked and the result is completely clean — a
  `declarations` object with zero entries can never read as a pass.
  `src/check-brand-coverage.test.ts` includes a dedicated agreement suite in
  `@vespeneventures/render`'s own test tree
  (`src/internal/tokens-brand-coverage-agreement.test.ts`, added alongside
  this release, since `@vespeneventures/tokens` cannot depend on
  `@vespeneventures/render` without a cycle) verifying `checkBrandCoverage`
  and `flattenTokens` agree on every non-brandable slot and on a typo'd slot
  name, by running the SAME override object through both and comparing
  outcomes.
- **`readBrandCss` / `parseBrandDeclarations`** — a small, hand-written,
  zero-runtime-dependency CSS reader that parses a real `.css` file's (or
  CSS text's) custom-property declarations: a bare `:root { ... }`, multiple
  selectors, comments, arbitrarily nested `@media`/`@supports`/`@layer`
  blocks, and multi-line declaration values. Anything it cannot resolve —
  an unterminated rule, a malformed declaration — is recorded into an
  `unchecked` list with a line number and detail, never silently dropped.
  `readBrandCss(path)` does the file I/O; `parseBrandDeclarations(css)` is
  the pure half, for CSS text already in hand.
- **`tokens-brand-check` CLI** (new `bin` entry) — wires `readBrandCss` and
  `checkBrandCoverage` into an installable CLI with the same three-state
  exit-code contract `@vespeneventures/copy`'s `copy-check` and
  `@vespeneventures/strategy`'s `strategy-facts-check` use: `0` clean, `1`
  at least one finding, `2` could not run (missing/unreadable file, or a
  region that could not be parsed) — "could not check" is never reported as
  a pass. Run `npx tokens-brand-check <brand-css-file>`.

### Note

Running `tokens-brand-check` against this package's OWN
`styles/brand-template.css` reports all 42 brandable slots as
`uncovered-brandable-slot` — 37 because every required slot's value is
intentionally left blank in the shipped template, and 5 because every
optional slot is intentionally left commented out. This is the expected,
honest result for an unfilled template, not a defect in the template: see
this package's own `brand-coverage.test.ts`, which already asserts (by a
different method — checking that every brandable token's NAME appears
somewhere in the file, live or commented) that the template's slot NAMES are
complete. `checkBrandCoverage` checks a stronger claim — real, non-empty
VALUES — which the template, being a template, cannot satisfy by
construction. A consumer's own filled-in `brand.css` is what this check is
built to run against.

**BREAKING for consumers on `@vespeneventures/render` < `0.1.0`'s or
`@vespeneventures/ui` < `0.3.0`'s existing `~0.5.0`/`^0.5.0` ranges:** a
caret/tilde range on a `0.x` package is patch-only (`~0.5.0`/`^0.5.0` do NOT
match `0.6.0`), so both this repository's own `@vespeneventures/render` and
`@vespeneventures/ui` had their `@vespeneventures/tokens` range bumped to
`~0.6.0`/`^0.6.0` in the same change that introduces this release — the
same discipline the `0.4.0` chart-tokens release and the `0.5.0` icon-tokens
release both already document here.

## [0.5.0] - Unreleased

### Added

- **Icon sizing tokens** (`--ui-icon-*`, 4 tokens, new `icon` family):
  `--ui-icon-sm`/`-md`/`-lg` (`16px`/`24px`/`32px`) plus `--ui-icon-stroke`
  (`2`) — the render contract for `@vespeneventures/ui`'s new `Icon` atom.
  The three size steps are **aliases** of `--spacing-lg`/`-xl`/`-2xl`,
  following the exact `var(--spacing-x, <fallback>)` shape `--ui-density-*`
  already established: coherent with the padding scale by default (an icon
  next to `md`-density padding sizes itself from the same vocabulary,
  automatically), independently reboundable without moving the padding
  scale everything else reads from. Three steps, not a free-standing pixel
  scale and not more than three: the one consumer of icon sizing that
  existed before this token family shipped exactly three (`sm`/`md`/`lg` at
  16/24/32px), so three is the evidence-backed count — a fourth/fifth step
  is a non-breaking future addition if a real need shows up, unlike
  shrinking an over-eager scale back down later.
  `src/naming.test.ts`'s `UI_NAMESPACE_PREFIX` table gained an `icon` entry
  so the new family is checked by the same naming-coverage test as every
  other `--ui-*` family; `--ui-icon-*` doesn't intersect any of the four
  Tailwind-namespaced families `src/tailwind-builtin-collision.test.ts`
  checks (it has no Tailwind `@theme` namespace at all, the same as every
  other `--ui-*` token), so that test needed no new coverage — verified by
  temporarily removing the `icon` entry from `naming.test.ts` and confirming
  the naming-coverage tests fail red before restoring it.
- **`--ui-icon-stroke` — a stroke-width token, argued for rather than
  assumed.** The glyph data this token pairs with (see
  `@vespeneventures/ui`'s new `./icons` subpath) is authored at a single
  fixed stroke weight with no lever a consumer could pull to make an icon
  set read lighter or heavier to match a brand's voice — the same kind of
  gap `--radius-default` exists to close for corner rounding. Unlike the
  three size steps, this is a LITERAL value, not an alias (there is no
  existing "stroke" scale to alias onto), and it is `brandable: true` — a
  brand identity choice in the same category as `--radius-default`, not a
  structural constant like `--ui-border-hairline`. `styles/brand-template.css`
  gained an optional (commented) slot for it; no dark-mode slot, since
  stroke weight is theme-invariant the same way `--radius-default` is.

## [0.4.0] - Unreleased

### Added

- **Chart tokens** (`--color-chart-*`, 22 tokens, new `chart` family):
  chrome (`-surface`, `-grid`, `-axis`, `-axis-label`), an 8-slot
  **categorical** palette (real, validated hues — this package's one
  deliberate exception to its own greyscale-by-default rule, since
  categorical hue is data encoding, not brand expression), a 7-step
  **sequential** ramp (one hue, light→dark, deliberately absolute across
  themes like `--color-neutral-*`), and a 3-slot **diverging** pair (the
  categorical blue/red slots as poles, aliased to `--color-line-base` for
  the neutral midpoint — never a hue at the midpoint). The categorical
  palette was validated with the dataviz method's `validate_palette.js`
  against this package's own real chart surfaces (`--color-chart-surface`:
  `#ffffff` light / `#242424` dark) for both modes — lightness band,
  chroma floor, CVD separation (adjacent and first-three-slots all-pairs),
  the normal-vision floor, and contrast vs. surface; full reports live in
  the introducing PR. `src/contrast.test.ts` gained a `chart chrome &
  categorical marks vs chart-surface` block extending the same real
  OKLCH/hex → WCAG math to this family (`internal/color.ts` gained hex
  support alongside its existing `oklch()` parsing).
- `chart` added to the family lists `excluded-names.test.ts` and
  `naming.test.ts` check — `chart` had been on the FORMER's exclusion list
  since this package's creation, on the premise that chart colors would
  ship from a separate charts package; that premise changed with this
  release, so the exclusion changed with it (see that test's own comment).

### Changed

- **BREAKING for consumers on `@vespeneventures/ui` < `0.2.0`:** this
  package now ships 150 tokens (was 128); the dark-block token count grew
  from 35 to 44. A caret range on a `0.x` package is patch-only
  (`^0.3.0` does NOT match `0.4.0`), so any consumer pinning
  `@vespeneventures/tokens` at `^0.3.0` needs that range bumped to
  `^0.4.0` in the same change that adopts these tokens — `@vespeneventures/ui`
  made that bump (peer + dev range) in its own `0.2.0`.

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
