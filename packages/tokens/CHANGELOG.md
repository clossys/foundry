# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
