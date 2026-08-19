# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.13.2] - 2026-08-19

### Changed

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/vespeneventures/foundry/issues/273). No runtime behavior changed.

## [0.13.1] - 2026-08-14

### Changed

- **Documented effective install behaviour on the GitHub Packages
  registry.** All six of this package's optional peers
  (`@internationalized/date`, `react`, `react-dom`, `react-aria-components`,
  `tailwind-merge`, `tailwindcss`) are correctly declared `optional: true`
  in `peerDependenciesMeta`, but `npm.pkg.github.com`'s packument omits
  that field entirely, so an installer resolving against this registry
  treats all six as required regardless of which subpath is imported — the
  token-only and `compiled.css` paths included. No `peerDependenciesMeta`
  block changed; see the README's "Token-only use" section and
  [issue #226](https://github.com/vespeneventures/foundry/issues/226) for
  the full evidence and decision.

## [0.13.0] - 2026-08-14

### Added

- **Optional-peer version guards, closing the remainder of issue #182.**
  This package's six optional peers (`@internationalized/date`, `react`,
  `react-dom`, `react-aria-components`, `tailwind-merge`, `tailwindcss` —
  see `peerDependenciesMeta`) previously produced no install-time signal
  in either direction: not when absent, not when installed at an
  incompatible version. A consumer on the wrong version learned about it
  from whatever a component happened to crash on deep inside the peer's
  own call surface, with nothing naming a version range as the cause.
  - `react` and `react-aria-components` are now guarded automatically,
    from every component subpath's own barrel (`atoms`, `blocks`,
    `shell`; `charts` and `theme` guard `react` only, since they never
    import `react-aria-components`). An absent or out-of-range install
    now throws a named error identifying the peer, the declared range,
    and the version actually found, before any component renders.
  - `tailwindcss` is guarded the same way from
    `src/compiled-css/generate.ts`, the one place this package's own
    build tooling imports it.
  - `tailwind-merge` cannot be guarded automatically without breaking
    browser bundling for every consumer (see `internal/peer-version.ts`'s
    own header for the full reasoning: it has neither an exported version
    nor a `"./package.json"` `exports` entry, and the file that imports
    it, `atoms/internal/cx.ts`, is reachable from every atom). It ships
    instead as a new export, `assertTailwindMergeVersion`, from
    `@vespeneventures/ui/tokens` — an explicit, opt-in, Node-only call, the
    same shape as this package's existing `assertTokenStylesLoaded`. See
    the README's Setup section for how to call it.
  - `react-dom` and `@internationalized/date` remain declared, optional
    peers with no runtime guard: neither has an adapter import site
    anywhere in this package's own source (`react-dom` is always the
    consumer's own render call; `DateField.tsx` names
    `@internationalized/date` as something a caller constructing a
    controlled `value` needs, but never imports it itself — only its test
    file does). There is nothing in this package to guard for either —
    see `internal/peer-guard-coverage.test.ts`, which enumerates every
    real import site in this package's source and confirms this directly
    rather than merely asserting it in prose.

## [0.12.0] - 2026-08-13

### Added

- **`@vespeneventures/ui/compiled.css`** — a GENERATED, precompiled utility
  stylesheet for `atoms`, letting a consumer with no Tailwind pipeline
  render this package's React components with real styling:
  ```css
  @import "@vespeneventures/ui/tokens.css";
  @import "@vespeneventures/ui/compiled.css";
  ```
  No Tailwind dependency, no `@source` line. Produced by a real Tailwind v4
  compile (`src/compiled-css/generate.ts`, using `tailwindcss`'s own
  `compile()` API — never a hand-maintained approximation) of every class
  candidate `src/compiled-css/class-scan.ts` statically finds in
  `src/atoms/`'s own source. Every declaration lives inside a single named
  layer, `foundry-ui-compiled`, declared after `foundry-ui-tokens` — the
  same #148-derived layering discipline `tokens.css` already uses — so a
  consumer's own unlayered CSS, or CSS in a later-declared layer, always
  wins on a conflicting property. `npm run check:compiled-css` (also part
  of `npm test`) re-derives the file from source and diffs it against what
  is committed, so it cannot silently drift; `npm run generate:compiled-css`
  regenerates it. Scoped to `atoms` only for this first pass — see
  `README.md`'s "Framework-portable components, without Tailwind" for the
  full contract, override-precedence rules, and what is and is not verified
  without a real browser. Reopened and re-scoped from the original,
  broader #174 sketch once a real external-consumer requirement existed;
  see the introducing PR for the alternatives weighed and why this
  boundary was chosen. (#174)

## [0.11.1] - 2026-08-13

### Added

- **`assertTokenStylesLoaded`** (`@vespeneventures/ui/tokens`) — a dev-only,
  SSR-safe runtime check for the silent-unstyled-render gap this README has
  long documented ("without the token CSS imported, ... every component
  renders unstyled, with no error anywhere to explain why"). Reads back a
  new sentinel custom property (`--ui-tokens-loaded`, appended to
  `styles/tokens.css`) via `getComputedStyle` and reports once, via
  `console.error` by default (or a caller-supplied `onMissing`), when it's
  missing. Opt-in only — importing the package never runs it — a no-op in
  production and wherever `document` doesn't exist, and never renders
  anything into the page: it does not reintroduce the injected banner #148
  removed, in any form. See the README's "Setup" section, step 3. (#182)

## [0.11.0] - 2026-08-13

### Added

- **Marketing/editorial content blocks** (`@vespeneventures/ui/blocks`):
  `Hero`, `FeatureGrid`, `Faq`, `PricingTable`, `Testimonial`,
  `ArticleBody`. The remainder of the marketing-blocks work started by the
  0.10.0 site-chrome release — chrome (`SiteHeader`/`SiteFooter`/
  `NavShell`/`SkipLink`) survives a route change and ships at `shell`;
  these six can each appear more than once on a page (this package's
  README, "Placement rules", test 3), which is what puts all six in
  `blocks` instead.
  - **`Hero`** — eyebrow, heading, description, actions slot, and an
    optional `media` slot that switches the layout to two columns when
    supplied rather than growing a `variant` prop for the same effect.
    `headingLevel` (`1 | 2`, default `1`) picks its heading element.
  - **`FeatureGrid`** — an optional eyebrow/heading/description region
    above a grid of icon/heading/description feature items (a homogeneous
    repeat, the same shape `NavGrid`'s cards already are).
  - **`Faq`** — an optional heading region above a list of question/answer
    pairs, each one this package's own `Disclosure` atom composed
    directly rather than a second hand-rolled expand/collapse mechanism.
    Independent, not a coordinated accordion.
  - **`PricingTable`** — an optional heading region above a grid of
    tiers (name, price, feature list, a `cta` slot, `isHighlighted` plus
    an optional `badge` slot for a recommended tier), built on this
    package's own `Card`/`Badge` atoms.
  - **`Testimonial`** — a quote plus attribution, rendered as a real
    `<figure>`/`<blockquote>`/`<figcaption>`. `attributorName` and
    `attributorRole` are always separate props; an optional avatar's
    `avatarSrc`/`avatarAlt` are required together at the type level, the
    same enforcement `Chip`'s `onRemove`/`removeLabel` pairing already
    establishes.
  - **`ArticleBody`** — a thin, token-styled container for pre-structured
    long-form content. Deliberately does not parse markdown or enforce a
    content-shape schema; that belongs to a separate, already-filed
    `@vespeneventures/surface` proposal.
  - Ships **no real words of any kind**: every heading, body line, CTA
    label, question/answer pair, tier name, and quote is a required or
    optional prop the consumer supplies, the same "this package owns
    visual vocabulary, never copy" boundary every prior release states.

## [0.10.0] - 2026-08-13

### Added

- **Public-site chrome** (`@vespeneventures/ui/shell`): `SkipLink`,
  `SiteHeader`, `NavShell`, `SiteFooter`. `Shell` already ships the
  five-slot frame an authenticated app needs; these four ship alongside it
  for the simpler, more opinionated chrome a public marketing/content site
  needs instead — a brand/nav/actions header, the primary navigation with
  a mobile drawer, grouped footer link columns, and the skip link that
  makes either bypassable by keyboard. Placement follows this package's
  own test #1 ("does it survive a route change?") — a site header/footer/
  nav survive route changes exactly the way `Shell`'s own regions do,
  which is what puts all four in `shell` rather than `blocks`.
  - **`SkipLink`** — the keyboard affordance every persistent-chrome page
    needs, made public and reusable rather than living only inside
    `Shell`'s own internal implementation: takes `targetId` (the jump
    target's `id`) and its own visible `children` (this package ships no
    built-in copy) as props, since a site's own page structure decides
    what "content" means.
  - **`SiteHeader`** — three regions that differ in kind: `brand`
    (required), `nav`, `actions`. Renders a real `<header>`, registering
    as the page's `banner` landmark at the top level.
  - **`NavShell`** — an ordinary inline `<nav>` from the `tablet`
    breakpoint up, and a trigger-plus-drawer below it, CSS-only breakpoint
    switching with no JS media-query state. The drawer is built on the
    same react-aria-components `DialogTrigger`/`ModalOverlay`/`Modal`/
    `Dialog` primitives this package's own `Dialog` atom already uses,
    which gives it — for free — a focus trap, focus moved in on open and
    restored to the trigger on close, Escape-to-dismiss, an
    `aria-expanded`/`aria-haspopup`-exposing trigger, background content
    hidden from assistive technology while open (`ariaHideOutside`), and a
    fully keyboard-operable open/navigate/close flow. Every one of those
    is covered by a real jsdom test in `NavShell.test.tsx`, including an
    explicit assertion that the rest of the page gains `aria-hidden` while
    the drawer is open and loses it again on close.
  - **`SiteFooter`** — two regions that differ in kind: `columns` (a
    responsive grid of `SiteFooter.Column`s) and `secondary` (a row below
    a hairline divider for a copyright line, legal links, a locale
    switcher). Renders a real `<footer>`, registering as the page's
    `contentinfo` landmark at the top level.

  No new dependencies, no new design tokens, and no new WCAG contrast
  pairs: every class these four components render reuses a token pairing
  `Button`, `Dialog`, `Shell.Header`, or `Shell.Footer` already established
  and already clears the WCAG contrast gate.

## [0.9.0] - 2026-08-13

### Added

- **A WCAG contrast gate** (`@vespeneventures/ui/tokens`, `ui-contrast-check`)
  — this package shipped the math for a real OKLCH/hex -> WCAG contrast-ratio
  check since before this release (`src/contrast.test.ts` has long asserted
  real AA/AA-large ratios for dozens of token pairs, across both themes), but
  the module doing that math lived at `tokens/internal/color.ts`, explicitly
  marked "not part of this package's public API" and reachable only by that
  one test. The capability existed; the gate did not. Four pieces ship:
  - **`color.ts`** (promoted from `internal/color.ts`, public now, exported
    from `@vespeneventures/ui/tokens`) — `parseOklch`, `oklchToLinearSRGB`,
    `hexToLinearSRGB`, `relativeLuminance`, `luminanceOf`, `contrastRatio`.
    No behavior change; only its visibility and header comment changed.
  - **`internal/resolve-token-value.ts`** — a generic `var(--property, ...)`
    ALIAS-CHAIN walker over a token REGISTRY (`resolveTokenValue(property,
    tokens)`), following `TokenDefinition.value` from entry to entry (e.g.
    `--color-chart-surface` -> `--color-surface-raised`) until it reaches a
    literal value, a property missing from the registry, or a cycle — each
    of the latter two reported on the result, never thrown or silently
    treated as "no value". This is deliberately NOT the same thing as
    `style-scan.ts`'s existing `resolveFallbackChain`, which parses `var()`
    fallback nesting in SOURCE CODE at a character offset; this walker has
    no source file involved at all, only a registry's own key space — see
    that file's header comment for the full distinction, written so the two
    are never conflated again.
  - **`contrast-pairs.ts`** — `CONTRAST_PAIRS`, an EXPLICIT, checked-in list
    of 25 (foreground, background[, composited-over]) token pairs and their
    WCAG minimum, ratified from `contrast.test.ts`'s own hand-curated pair
    map rather than re-derived. This gate was originally proposed as
    self-extending — one pair auto-derived per `--<role>-on-<ground>`-shaped
    token name — but that convention covers only 5 of this package's real
    154 tokens (`--color-ink-on-accent`, `--color-ink-on-inverse`,
    `--color-accent-on-inverse`, `--color-line-on-inverse`, `--ui-ring-on-
    inverse`; a 6th, `--color-ink-on-inverse-muted`, contains `-on-` too but
    is a muted VARIANT of `--color-ink-on-inverse`, not a distinct
    role-on-ground pairing — see `contrast-pairs.ts`'s own header for the
    full accounting); built that way, the gate would have checked almost
    nothing while reading as though it checked everything. Decorative roles
    (`--color-line-*`, `--color-chart-
    grid`, `--color-overlay-scrim`, `--ui-elevation-*`, `--color-skeleton-
    fill`, `--ui-ring-*`) are excluded per WCAG 1.4.11's own scope — see the
    file's header for which roles and why, precisely.
  - **`checkTokenContrast`** (`contrast-gate.ts`) — the pure gate: resolves
    every pair's tokens (through any alias chain), computes the real ratio,
    and reports one of four outcomes. A real threshold miss with no
    exception is `findings`, rule `"below-threshold"`. A pair that could
    not be evaluated at all is `unchecked`
    (`"unresolvable-token"`, `"cyclic-alias"`, `"unparseable-color-value"`)
    — mirroring `checkTokenPurity`'s own findings/unchecked split. Never
    passes on an empty run: zero pairs or an empty token registry reports
    `reason: "nothing-to-check"`, never `ok: true`.
  - **`ContrastException` — WCAG 1.4.11's own relief, carried as data, not
    a bare comment.** A `ContrastPair` may carry an `exception`: a real
    `wcagClause`, a real `compensatingMechanism`, and a real `rationale`,
    all required and non-blank. A pair still under its floor with a VALID
    exception is `relieved` — printed in every report, never hidden, but
    not a failure. A pair that CLEARS its floor while still carrying that
    exception is a *different* finding, `"stale-exception"` — the relief
    it claims is no longer needed, and this is what stops a documented
    exception from silently outliving the condition that justified it
    (nothing else would ever prompt its removal). An exception missing any
    required field is a THIRD finding, `"invalid-exception"`, checked
    first and regardless of the measured ratio — an unjustified exception
    is a defect in the policy data itself, not something a lucky ratio can
    excuse. `contrastPairsForTheme(theme: "light" | "dark")`
    (`contrast-pairs.ts`) is what attaches this package's OWN real relief
    to `CONTRAST_PAIRS`, per theme — ported directly from
    `contrast.test.ts`'s own `WARN_SLOTS_BY_THEME` (light-mode categorical
    slots 3/4/5; dark carries none, since the dark palette's own steps
    were chosen to clear 3:1 outright) — rather than baking a
    theme-agnostic exception onto the bare array, which stays
    exception-free for a caller building their own pairs against their own
    palette.
  - **`ui-contrast-check [tokens-css-file]`** (`contrast-cli.ts`) — the
    installable CLI, mirroring `ui-token-check`'s shape and this
    repository's three-state exit contract (`0` clean, `1` findings, `2`
    could not run — `2` also covers a non-empty `unchecked` list and a
    zero-pairs run, the same "could not check must never read as a pass"
    discipline every gate CLI here holds to). Defaults to this package's own
    `styles/tokens.css` and checks BOTH the light `:root` block (against
    `contrastPairsForTheme("light")`) and, when present, the
    `:root[data-theme="dark"]` block (against `contrastPairsForTheme("dark")`)
    — merging each dark declaration on top of the light ones first
    (mirroring a real CSS cascade), because a handful of real alias tokens
    (`--color-chart-surface`, `--color-ink-on-accent`, ...) are declared
    only in `:root` and deliberately never redeclared in the dark block.
    **Wired in, not just installed:** a gate that ships as a `bin` with
    nothing actually invoking it is decorative — this repository's own
    root `npm run check:contrast` (new script, in the `check` chain
    between `check:package-governance` and `typecheck`) runs it against
    this package's own `styles/tokens.css`, and CI's new
    `WCAG contrast gate (ui-contrast-check)` job does the same on every
    push and pull request.
  - **A real, currently-shipping WCAG miss this gate surfaces, reported
    rather than excluded — and legitimately RELIEVED, not hidden:** the
    light-mode categorical chart marks at slots 3/4/5
    (`--color-chart-categorical-3/4/5`, aqua/yellow/magenta) measure below
    the 3:1 AA-large floor against `--color-chart-surface` — 2.82:1, 2.17:1,
    and 2.69:1. `contrast.test.ts` already documents this as an accepted
    "WARN" band (the dataviz palette method's "relief rule": legal only
    because this package's chart layer ships mandatory direct labels/legend
    and a table-view fallback for every chart, never color alone);
    `contrastPairsForTheme("light")` carries that same relief as gate
    policy, so these three report as `relieved`. `ui-contrast-check` run
    against this package's own `styles/tokens.css` with no arguments
    returns `0` — not because the failures were excluded from the pair
    list to force a green run, but because the relief is real, documented,
    and machine-checkable both directions (a slot that stops needing it
    becomes a `"stale-exception"` finding, not a silent pass).

## [0.8.0] - 2026-08-13

### Added

- New `@vespeneventures/ui/theme` subpath — the JavaScript half of this
  package's theming contract, matching the three-state `data-theme`
  contract `tokens.css` already defined in CSS (attribute absent follows
  the OS; `data-theme="light"`/`"dark"` force a theme regardless of the
  OS). Nothing shipped previously actually drove that attribute, so a
  consumer could not build a working theme toggle without hand-writing
  the storage read, the three-state branch, and a head script themselves.
  Three pieces ship:
  - `getThemeInitScript()` — a self-contained script, returned as a
    string, for a consumer's `<head>`, so the correct `data-theme` is
    stamped before first paint. A React component cannot run before the
    document paints, so this is deliberately not something
    `ThemeProvider` does on its own — see the README's "Wiring up a theme
    toggle" for why, and the full setup.
  - `ThemeProvider` / `useTheme()` — holds and persists the three-state
    preference, keeps `<html data-theme>` and the native `color-scheme`
    CSS property in sync (so native form controls, scrollbars, and
    autofill match the theme too), and resolves `"system"` against a
    live `prefers-color-scheme` subscription that updates without a
    reload if the OS theme changes while the page is open.
    `preference` (what was chosen) and `resolvedTheme` (what's actually
    displayed) are deliberately separate values — collapsing them would
    leave either an icon-picking component or a selected-option
    component with no correct value to read. SSR-safe: never reads
    `window`/`document`/`localStorage` during render.
  - `ThemeToggle` — an accessible control built from this package's own
    `Button`/`Icon` atoms, cycling System → Light → Dark → System (see
    `ThemeToggle.tsx`'s own doc comment for why a cycle rather than a
    switch-plus-reset pair). Keyboard-operable, and announces every
    change through a live region.
  - `theme-script-parity.test.ts` asserts the head script and
    `ThemeProvider` resolve identically for every input (nothing stored,
    each valid state, a malformed stored value, storage that throws, a
    non-default storage key) — both call the SAME underlying functions
    (one directly, one stringified into the head script), so they cannot
    silently drift into two different implementations of the same rule.

## [0.7.2] - 2026-08-13

### Fixed

- `styles/theme.css` could crash a consuming application's entire
  stylesheet. The six `--breakpoint-*` declarations inside `@theme inline`
  used the same self-referential `var(--x, default)` form as every other
  token in that block, which is correct for the other 70 — `var()` resolves
  fine in a property value — but fatal for these six. `@theme inline`
  substitutes the declared value into generated utilities, so a `tablet:`
  or `desktop:` utility compiled to `@media (width >= var(--breakpoint-tablet,
  768px))`. A media-query condition cannot resolve `var()`, so the at-rule
  is invalid and the whole stylesheet fails to parse — a consumer importing
  this package's own documented `theme.css` and using any responsive
  utility saw every route fail to render. The six now carry literal
  lengths. Verified against a real Tailwind v4 compile, before and after.
  Surfaced by a consumer integration.
- A regression test now asserts that no `--breakpoint-*` or `--container-*`
  declaration inside `@theme inline` contains a `var()` reference, because
  both namespaces land in at-rule conditions rather than property values.
  `--container-*` fails differently — Tailwind emits no rule at all rather
  than invalid text — and this package ships no container tokens today, but
  the guard covers it.

### Changed

- Breakpoints are the one token family a consumer cannot override by
  redeclaring the plain custom property, since the value must be a literal.
  The README now documents this and the mechanism that does work: a
  consumer's own `@theme` block declared *after* importing this package's
  `theme.css` wins, because Tailwind merges `@theme` blocks in source order.
  Verified by compiling both orderings.
- The README's Tailwind `@source` guidance now carries a consumer-reported
  caveat that the plain-path form does not work under Turbopack with pnpm,
  because Turbopack does not follow pnpm's store symlink — no utilities are
  generated and nothing errors. The `@source inline(...)` alternative is
  documented. This repository has not reproduced the Turbopack behaviour
  itself and the caveat says so.

## [0.7.1] - 2026-08-13

### Fixed

Six issues surfaced by a consumer integration:

- Removed the stale "Release status" caveat claiming this package "has not
  completed a public registry release." This package is already marked
  published in this repository's own lifecycle catalog — the caveat, not
  the package, was outdated (#147).
- `styles/tokens.css`'s token declarations now live in a named `@layer
  foundry-ui-tokens` instead of unlayered `:root`. An unlayered rule always
  outranks a layered one regardless of import order, so these tokens
  previously won over a host app's own Tailwind v4 `@layer theme`
  unconditionally rather than composing with it (#148).
- The "No brand binding" startup banner now respects a
  `data-suppress-brand-banner` attribute on `<html>`. It stays default-on —
  an unbranded render should never quietly pass as finished — but a
  consumer shipping unbranded primitives on purpose previously had no way
  to say so (#148).
- `ui-token-check` gained a `--tokens <path-to-json>` flag to check scanned
  source against a consumer's own token registry instead of always checking
  against this package's own `TOKENS`, where every legitimate,
  consumer-token-backed literal previously reported as unbacked. `--tokens`
  replaces the default registry for the run rather than merging with it
  (#149).
- `checkTokenPurity`'s finding messages now take an optional
  `registryLabel` and attribute themselves to the registry actually passed
  in, rather than always naming `@vespeneventures/ui/tokens` regardless of
  which registry a caller supplied (#150).
- Relaxed the declared peer floor for `@internationalized/date` (`^3.12.3`
  → `^3.12.2`) and `react-aria-components` (`^1.20.0` → `^1.19.0`). Neither
  version had a documented reason to sit ahead of what a real consumer tree
  already commonly resolves; installing into a real Next.js + Tailwind v4
  app produced an `unmet peer` warning against versions one behind each
  floor, non-fatal only because both peers are already optional (#154).

## [0.7.0] - 2026-08-12

### Added

- **The token layer moved into this package.** `@vespeneventures/tokens`
  (last published at `0.6.0`) is folded in whole: `@vespeneventures/ui/tokens`
  ships the typed `TOKENS` export, brand CSS parsing, and the brand-coverage
  gate with no React runtime; `@vespeneventures/ui/tokens.css`,
  `/theme.css`, and `/brand-template.css` ship the same three CSS files the
  standalone package shipped; `TOKENS.md` documents the layer and is in the
  published `files` list alongside the existing `README.md`. A consumer can
  now install tokens alone:

  ```bash
  npm install @vespeneventures/ui
  ```

  ```css
  @import "@vespeneventures/ui/tokens.css";
  ```

  with no React, React Aria, or Tailwind requirement — `tokens.css` is
  ordinary CSS custom properties.
- `tokens-brand-check`, the standalone package's brand-coverage CLI, ships
  as a second `bin` entry alongside the existing `ui-token-check`.

### Changed

- **Version jumps `0.4.0` → `0.7.0`.** This is the same commit that removed
  `packages/tokens` from this repository; the jump reflects that
  consolidation, not four intermediate `ui` releases that never happened.
  `docs/contracts/package-lifecycle.json` now records
  `@vespeneventures/tokens` as `deprecated`, replacement
  `@vespeneventures/ui ^0.7.0`.
- **`@vespeneventures/tokens` is no longer a dependency of this package —
  it no longer needs to be, since its contents now ship as this package's
  own `/tokens` subpath.** A consumer migrates each import:

  | Old import | New import |
  | --- | --- |
  | `@vespeneventures/tokens` | `@vespeneventures/ui/tokens` |
  | `@vespeneventures/tokens/tokens.css` | `@vespeneventures/ui/tokens.css` |
  | `@vespeneventures/tokens/theme.css` | `@vespeneventures/ui/theme.css` |
  | `@vespeneventures/tokens/brand-template.css` | `@vespeneventures/ui/brand-template.css` |
- **Every component peer became optional.** `react`, `react-dom`,
  `react-aria-components`, `tailwind-merge`, `tailwindcss`, and
  `@internationalized/date` move to `peerDependenciesMeta` with
  `optional: true`; `react-aria-components` and `tailwind-merge` were
  previously regular `dependencies`, not peers at all. A consumer who only
  wants the token layer installs none of them; a consumer importing
  `atoms`/`blocks`/`shell`/`charts` still installs the peers those subpaths
  actually use, but npm now reports a missing one instead of resolving a
  hidden transitive version.
- `sideEffects` narrowed from `false` to `["./styles/*.css"]`, reflecting
  the CSS files this package now ships directly.
- `files` gained `styles` (the three CSS files above) and `TOKENS.md`.
- `description` rewritten to describe a self-contained visual system
  (tokens, theme CSS, components, icons, charts, gates) rather than
  components styled by a separate tokens package.

### Removed

- **The `./views` subpath is gone.** `ErrorView` and `AuthView` moved to
  `@vespeneventures/surface/web`; this package stops exporting whole-page
  compositions and keeps only reusable primitives (`atoms`, `blocks`,
  `shell`, `charts`, `icons`, `gate`) plus the token layer. There is no
  compatibility re-export — a consumer importing
  `@vespeneventures/ui/views` must switch to `@vespeneventures/surface/web`.

## [0.4.0] - Unreleased

### Added

- **Token-purity scanner and gate** (`@vespeneventures/ui/gate`,
  `ui-token-check` CLI) — the visual mirror of `@vespeneventures/copy`'s
  scanner gate. Before this release, `ui` shipped no gate at all: a
  hardcoded `#3b82f6` or `padding: 13px` anywhere in this package's source
  was invisible in a way an unregistered user-facing string had not been
  since `copy` shipped. `scanStyleSources` walks a real source tree and
  extracts every hardcoded styling literal — hex colors, `rgb()`/`rgba()`/
  `hsl()`/`hsla()`/`oklch()`/`oklab()`/`lab()`/`lch()` color functions, raw
  CSS lengths (`13px`, `1.5rem`, `2em`, ...), and Tailwind arbitrary-value
  classes (`bg-[#3b82f6]`, `p-[13px]`, `w-[var(--x,64px)]`) — while leaving
  every legitimate Tailwind token class (`text-ink-primary`, `bg-accent`,
  `p-4`, `z-10`) untouched by construction, not by an allowlist. Zero
  runtime dependencies, matching `copy`'s own scanner (this repository's
  CI `safety` job runs gate scripts with no `npm ci`). `checkTokenPurity`
  is the pure gate, with THREE rules, not two, because a bare hardcoded
  literal and a `var(--token, <fallback>)`'s own fallback literal are
  different problems with different remedies: a BARE literal (the token
  system not consulted at this call site at all) is `severity: "error"`,
  reported as `"hardcodes-token-value"` when it matches a real token's
  value exactly or `"raw-value-no-token-backing"` when it matches none; a
  `var()` FALLBACK literal (the token IS consulted, and wins whenever
  `@vespeneventures/tokens`' CSS is actually loaded) is `severity:
  "warning"`, reported as `"token-value-duplicated-in-fallback"` — a
  latent drift risk, not a live defeat of the token system, and the
  message states whether the fallback currently matches, is consistent
  with, or has already drifted from the referenced token's real declared
  value. Which token a fallback literal belongs to is resolved
  STRUCTURALLY, by parsing `var(...)` nesting (peeling through any
  wrapping non-`var` function like `clamp()`/`rgba()` to find the true
  enclosing `var()`, and always resolving a nested chain to the INNERMOST
  wrapper) — never by searching the registry for a same-valued entry,
  which is how an earlier draft of this gate wrongly attributed
  `atoms/Icon.tsx`'s `16px` (the fallback of `var(--ui-icon-sm,
  var(--spacing-lg, 16px))`) to an unrelated token that merely happened to
  share its value. Every rule is waivable with a `token-gate:ignore`
  marker on its own source line — mirroring `copy-gate:ignore` exactly,
  never a silent allowlist buried in config. `ui-token-check` ships the
  same three-state exit contract every gate CLI in this repository uses:
  `0` clean, `1` findings (error or warning — both fail a clean run), `2`
  could not run — including an explicit `unchecked` state (an unterminated
  arbitrary-value bracket, an unresolvable color function, an invalid hex
  length, or an arbitrary-value class this gate cannot classify as in- or
  out-of-scope) that always prevents a clean `0`, the same discipline
  `copy-check`'s own `ScanResult.unchecked` holds to. Run against this
  package's own `src/`: 44 findings (18 error, 26 warning), 4 unchecked —
  the warnings are almost entirely `var(--token, <literal fallback>)`
  patterns in `atoms/internal/ui-vars.ts`, `charts/internal/chart-vars.ts`,
  `shell/internal/shell-vars.ts`, and `views/internal/view-vars.ts` whose
  literal fallbacks duplicate a token's own shipped default with nothing
  keeping the two in sync — left unfixed (and unwaived) in the PR that
  introduced this gate; see that PR's description for the full accounting.

### Fixed

- Relaxed the declared peer floor for `@internationalized/date` (`^3.12.3`
  → `^3.12.2`) and `react-aria-components` (`^1.20.0` → `^1.19.0`). Neither
  version had a documented reason to sit ahead of what a real consumer tree
  already commonly resolves; installing into a real Next.js + Tailwind v4
  app tree produced an `unmet peer` warning against versions one behind
  each floor, non-fatal only because both peers are already optional. Both
  changes only widen what's accepted — nothing that satisfied the old floor
  stops satisfying the new one.
- `styles/tokens.css`'s token declarations now live in a named `@layer
  foundry-ui-tokens` instead of unlayered `:root` — an unlayered rule
  always outranks a layered one regardless of import order, which made
  these tokens win over a host app's own Tailwind v4 `@layer theme`
  unconditionally rather than composing with it.
- The "No brand binding" startup banner now respects a
  `data-suppress-brand-banner` attribute on `<html>`. It stays default-on
  (an unbranded render should never quietly pass as finished) but a
  consumer shipping unbranded primitives on purpose previously had no way
  to say so.
- `ui-token-check` gained a `--tokens <path-to-json>` flag to check scanned
  source against a consumer's own token registry instead of always
  checking against this package's own `TOKENS` — previously every finding
  against a real consumer tree read as unbacked, because the consumer's
  own tokens were never in scope. `--tokens` replaces the default registry
  for the run rather than merging with it.
- `checkTokenPurity`'s finding messages now take an optional
  `registryLabel` and attribute themselves to the registry actually
  passed in, rather than always saying `@vespeneventures/ui/tokens`
  regardless of which registry a caller supplied.

## [0.3.0] - 2026-08-07

### Changed

- `@vespeneventures/tokens` dependency range bumped `^0.5.0` -> `^0.6.0`
  (peer and dev) — that package's `0.6.0` is a MINOR release (a `0.x`
  caret range is patch-only, so the old range would not have matched it)
  adding `checkBrandFileCoverage`/`readBrandCss`/the `tokens-brand-check` CLI;
  this package does not use any of the three, but the range must still
  move in lockstep — see `@vespeneventures/tokens`' own CHANGELOG.

### Added

- **`Icon` atom** — the glyph render contract (size, colour, accessibility)
  this package previously had no atom for. Accepts either `glyph`
  (structured `IconNode` data — the shape `@vespeneventures/ui/icons` ships)
  or `children` (raw SVG elements/a component), mutually exclusive at the
  type level. Colour always inherits `currentColor` (no `color`/`fill`/
  `stroke` prop); size reads `@vespeneventures/tokens`' new `--ui-icon-sm`/
  `-md`/`-lg` tokens (`0.5.0`); stroke weight reads the new
  `--ui-icon-stroke` token, applied via `style` (not the `strokeWidth`
  attribute) for reliable `var()` resolution. Accessibility is a
  discriminated union — `decorative: true` XOR a required `label` — ported
  from this scope's own pre-merge, standalone `icons` package's own
  `IconAccessibilityProps`; `src/atoms/internal/icon-contract.check.tsx`
  proves both this union and the `glyph`/`children` union fail to compile
  when violated, and does so in a file `tsc` actually checks (`*.check.tsx`,
  not `*.test.tsx` — see that file's header comment and issue #24 for why
  the distinction matters: a `@ts-expect-error` in a test file is
  transpiled, never type-checked, by this package's toolchain). No
  `<Icon name="..."/>` registry — `glyph`/`children` are ordinary slots,
  this package's own "Slots beat mode props" rule applied one level
  further.
- **`@vespeneventures/ui/icons`** — a new subpath shipping 32 `IconNode`
  glyph-data exports (`AlertTriangle` … `XCircle`, no `Icon` suffix — see
  README.md "Naming convention" for why the suffix was dropped), folded in
  from this scope's now-deleted standalone `icons` package (`0.1.0`,
  never published). Pure data: no React import, no rendering
  logic, `sideEffects: false`; `src/icons/tree-shake.test.ts` (adapted from
  that package's own test, with a new bundle-output marker — a bare
  identifier collides for three renamed pairs under the no-suffix
  convention, see that file's header comment) proves importing one glyph
  bundles exactly that glyph, measured against real `esbuild` output, not
  assumed. `src/icons/icons.test.ts` checks the data's own shape (32
  entries, unique names, well-formed `[tag, attrs]` tuples). Curation
  evidence (how the 32 were chosen), the Lucide→this-package rename table,
  and the refresh procedure against a newer Lucide release all carried over
  into README.md, "Icon glyph data"; `THIRD-PARTY-NOTICES.md` (Lucide ISC +
  Feather MIT) carried over too and is in this package's published `files`
  list, verified present in a real `npm pack` listing before this PR.
  `src/ladder.test.ts` gained a new describe block: `icons` is a pure-data
  leaf BELOW `atoms` (even more foundational than `atoms` itself) — nothing
  under `src/icons/` may import from anywhere else in this package, and
  `atoms` may import `icons` (proven by a real edge: `atoms/Icon.tsx`
  imports the `IconNode` type, type-only, from `icons/types.ts`).
- `@vespeneventures/tokens` peer + dev range bumped `^0.4.0` → `^0.5.0` in
  the same change (a caret range on a `0.x` package is patch-only, so the
  old range would not have matched tokens' `0.5.0` and the workspace link
  would 404 against the registry) — needed for the new `--ui-icon-*`
  tokens `Icon` reads.
- `esbuild` added as a `devDependency` (carried over from the pre-merge
  icons package, for `src/icons/tree-shake.test.ts`).

### Changed

- **This scope's standalone `icons` package is retired.** Its glyph
  data lives at `@vespeneventures/ui/icons` now (see above); its render
  contract lives at `@vespeneventures/ui/atoms`' new `Icon`. The package
  itself, its `packages/icons/` directory, and its workspace entry are all
  removed from this repository. It was never published beyond `0.1.0`
  internal review, so there is no deprecation notice to issue on the
  registry.
- README.md: the "no bundled icon set" claim under "What's deliberately
  not here" → "Shell" is narrowed to what's still true (`Shell` doesn't
  assign icons to nav items on a consumer's behalf) now that this package
  as a whole does ship a glyph set elsewhere.

## [0.2.0] - 2026-08-07

### Added

- **`charts` layer**: a new `./charts` subpath export, sibling to
  `./atoms`/`./blocks`/`./views`/`./shell` rather than another rung of the
  atoms → blocks → views ladder — `charts` may import `atoms`; nothing
  else in this package imports from `charts` (`src/ladder.test.ts`
  extended accordingly). Four components, dependency-free SVG (no
  charting library dependency): `ChartFrame` (shared plot/axes/grid/
  legend/table container), `BarChart`, `LineChart`, `Sparkline`. Every
  mark reads color through `@vespeneventures/tokens`' new chart-color
  family (`--color-chart-*`, that package's `0.4.0`) via
  `charts/internal/chart-vars.ts`; scale math lives in
  `charts/internal/scale.ts` (`linearScale`, `bandScale`, `timeScale`,
  `niceTicks`) — both `internal/` and unexported from `charts/index.ts`,
  the same convention `atoms/internal/cx.ts`/`ui-vars.ts` already set.
  One axis always (no dual-axis option on `BarChart`/`LineChart`); color
  follows the entity's array position, never its rank; a legend appears
  only for 2+ series; every chart (including `Sparkline`) ships a
  table-view fallback; every chart except `Sparkline` ships a hover layer
  (crosshair + shared tooltip on `LineChart`, per-mark tooltip on
  `BarChart`) reachable identically on keyboard focus.
- `@vespeneventures/tokens` peer + dev range bumped `^0.3.0` → `^0.4.0` in
  the same change (a caret range on a `0.x` package is patch-only, so the
  old range would not have matched tokens' `0.4.0` and the workspace link
  would 404 against the registry).

## [0.1.0] - Unreleased

### Added

- Initial release: the `atoms` layer of a three-layer component ladder
  (`atoms` → `blocks` → `views`). Five components — `Button`, `TextField`,
  `Badge`, `Card`, `Breadcrumb` — built on `react-aria-components` for
  behavior/accessibility and styled with Tailwind utility classes generated
  from `@vespeneventures/tokens`. `Breadcrumb` builds on
  `react-aria-components`' `Breadcrumbs`/`Breadcrumb`/`Link` collection
  components for nav semantics and automatic `aria-current` placement; it
  ships as an atom because its parts (crumbs) are homogeneous repeats, not
  named regions.
- `./atoms` subpath export.
- The `blocks` layer: `PageHeader`, `EmptyState`. Each owns the internal
  layout of multiple named regions and composes atoms and/or layout
  through `ReactNode` slots rather than a `mode`/`variant` prop.
- `./blocks` subpath export, alongside `./atoms`.
- `src/ladder.test.ts`: structurally enforces that `atoms/` never imports
  from `blocks/`.
- Eight more atoms — `Link`, `Checkbox`, `Switch`, `Select`, `Textarea`,
  `Avatar`, `Spinner`, `Menu` — bringing the `atoms` layer to thirteen
  components. `Link`, `Checkbox`, `Switch`, `Select`, and `Textarea` are
  built on the matching `react-aria-components` primitive, the same way
  `Button`/`TextField` are; `Menu` builds on `MenuTrigger`/`Menu`/
  `MenuItem`/`Popover` for its open/close, arrow-key navigation, and
  disabled-item handling. `Avatar` and `Spinner` are plain markup, like
  `Badge`/`Card` — neither is interactive, so neither needs a
  react-aria-components primitive.
- The `shell` layer: `Shell`, the persistent application frame (`Header`,
  `SideNav`, `Main`, `Rail`, `Footer` slots — every one but `Main`
  optional, and correct with none of them: no empty grid track, no
  phantom spacing), plus its skip-to-content link. Slots, never a
  `mode`/`variant` prop, for structurally different chrome. `SideNav`
  collapses to an icon-rail width below the `tablet` breakpoint and `Rail`
  hides entirely below `desktop`, both CSS-only.
- `Toaster` and the imperative `toast` API (`toast.success`/`.error`/
  `.warning`/`.info`, plain `toast(...)`, each returning a dismiss
  handle) — a runtime service, not a rung of the atoms → blocks → views
  ladder, shipped alongside `shell` because its lifetime requirement is
  identical. Built on react-aria-components' `ToastRegion`/`Toast`/
  `ToastContent` for portal rendering, focus management, and pausing on
  hover/focus; overrides `ToastContent`'s always-assertive default so only
  `danger` toasts are an assertive live region (`role="alert"`) — every
  other variant is polite (`role="status"`).
- `./shell` subpath export, alongside `./atoms` and `./blocks`.
- `src/ladder.test.ts` extended: no file under `src/atoms/` or
  `src/blocks/` may import `views/` or `shell/`, and `shell/` may never
  import `views/`. `shell/` importing `atoms/` (and `blocks/`, though
  nothing under `shell/` currently does) remains permitted, the same
  direction `blocks/` importing `atoms/` already was.
- Three more atoms — `Dialog`, `Tabs`, `Table` — bringing the `atoms` layer
  to sixteen components. `Dialog` builds on react-aria-components'
  `DialogTrigger`/`ModalOverlay`/`Modal`/`Dialog`/`Heading` for a modal
  overlay with a focus trap, focus restoration on close, Escape-to-dismiss,
  and a page scroll lock, plus a `size` prop and a composable
  `Dialog.Heading` sub-component that wires the dialog's `aria-labelledby`.
  `Tabs` builds on `Tabs`/`TabList`/`Tab`/`TabPanel` for roving-tabindex
  arrow-key navigation between panels, via `Tabs.List`, `Tabs.Tab`, and
  `Tabs.Panel` sub-components. `Table` ships compositional table
  primitives — `Table.Header`, `Table.Column`, `Table.Body`, `Table.Row`,
  `Table.Cell` — built on `Table`/`TableHeader`/`TableBody`/`Column`/`Row`/
  `Cell`, with `sortDescriptor`/`onSortChange` sorting and
  `selectionMode`/`selectedKeys` row selection passed straight through;
  `Table.SelectAllCheckbox` and `Table.SelectionCheckbox` reuse this
  package's own `Checkbox` atom (via react-aria-components'
  `slot="selection"`) for the selection column, including the
  indeterminate select-all state — the one place in this package where an
  atom composes another atom, which `ladder.test.ts` and the README both
  confirm is the explicitly-permitted direction (a sibling atom, not a
  `blocks/` import). `DataTable` and `ConfirmDialog` — the finished,
  opinionated assemblies built on `Table`'s and `Dialog`'s primitives —
  remain deliberate follow-ups, not shipped here.
- Six more atoms — `Field`, `Skeleton`, `Tooltip`, `Banner`, `RadioGroup`,
  `Popover` — bringing the `atoms` layer to twenty-two components. `Field`
  is the general label/description/error wrapper `TextField` bundles for
  the text-entry case, for a control this package doesn't ship an atom for;
  its `children` is a render prop (not `React.cloneElement`) receiving the
  generated id and ARIA wiring to spread onto whatever control it wraps.
  `Skeleton` is a loading placeholder (`shape`: `"text" | "block" |
  "circle"`) styled with `--color-skeleton-fill`, with the same
  "decorative unless it's the one accessible loading signal"
  `aria-hidden`/`role="status"` split `Spinner`'s own `label` prop already
  uses. `Tooltip` builds on react-aria-components' `TooltipTrigger`/
  `Tooltip` for hover-AND-focus opening, Escape-to-dismiss, and the
  warm-up/cool-down delay between tooltips shown in quick succession.
  `Banner` is a persistent inline message region (not a toast) over the
  same four status tokens `toast(...)` and `Badge` already share, with
  `role`/`aria-live` following severity the same way `Toaster`'s own
  `ToasterContent` does. `RadioGroup` builds on react-aria-components'
  `RadioGroup`/`Radio` for roving-tabindex arrow-key navigation between a
  visible set of mutually-exclusive options, via a composable
  `RadioGroup.Radio` sub-component. `Popover` builds on `DialogTrigger`/
  `Popover`/`Dialog` — the general anchored-overlay primitive, for content
  shapes `Menu`/`Select`/`Tooltip`'s own specific popovers don't already
  cover.
- Eight final atoms — `DateField`, `ComboBox`, `SearchField`, `FileTrigger`,
  `Disclosure`, `ProgressBar`, `Separator`, `Chip` — completing the `atoms`
  layer at thirty components. `DateField` builds on react-aria-components'
  `DateField`/`DateInput`/`DateSegment` for segmented, keyboard-editable date
  entry (per-segment increment/decrement, auto-advance, locale-correct
  order); its `value`/`defaultValue` are `@internationalized/date`
  `DateValue`s, which is why that package is now a real `dependencies`
  entry of this one, not merely an unlisted transitive of
  react-aria-components. A full `DatePicker` was considered and deliberately
  not built instead — it would require a `Calendar` atom this package
  doesn't ship. `ComboBox` builds on react-aria-components' `ComboBox`
  composed with its own `Input`/`Button`/`Popover`/`ListBox`/`ListBoxItem`
  for a searchable, filterable single-choice field over a large option set,
  using the same `options` array shape `Select` already established.
  `SearchField` builds on `SearchField`/`Input`/`Button` for a search input
  with real `type="search"` semantics, a clear button wired through
  context, and Escape-to-clear. `FileTrigger` builds on react-aria-
  components' own `FileTrigger` for OS file-picker access from an arbitrary
  pressable trigger; it deliberately does not accept `className` (react-
  aria-components' own implementation hardcodes the hidden input's
  `className` to `""`, discarding whatever is passed) and deliberately
  excludes upload progress, drag-and-drop, and file previews — a block's
  job. `Disclosure` builds on `Disclosure`/`DisclosurePanel` (both shipped
  in the `react-aria-components@1.20.0` already installed, so no
  `<details>` fallback was needed) for a single expandable/collapsible
  section with correct `aria-expanded`/`aria-controls` wiring and content
  that stays in the DOM (toggling `hidden`) rather than mounting/
  unmounting. `ProgressBar` builds on react-aria-components' own
  `ProgressBar` for determinate and indeterminate progress, correctly
  omitting `aria-valuenow` while indeterminate. `Separator` builds on
  react-aria-components' own `Separator` for horizontal/vertical dividers,
  plus a `decorative` prop (using react-aria-components' `render` escape
  hatch, since neither `filterDOMProps`'s nor `useSeparator`'s own allowlist
  ever forwards a passed `aria-hidden` prop onto the rendered element) for a
  purely visual divider hidden from assistive tech. `Chip` is a removable
  label — a label region plus a remove-affordance region — shipped as a
  distinct component from `Badge` (which is static, one region only) rather
  than a `removable` variant of it, per this package's own "does the
  variant change the SET of named regions?" rule; its remove control is
  react-aria-components' own `Button`, and `removeLabel` is required at the
  TYPE level whenever `onRemove` is supplied, so every chip's remove control
  gets an accessible name that identifies WHICH chip it removes.

### Changed

- `token-parity.test.ts` redesigned: candidate Tailwind classes (from a
  `className="..."` attribute, a `cx(...)` call's arguments, or a
  `Record<Variant, string>` variant map) are now compiled for real against
  this package's own token CSS, via `tailwindcss`'s own
  `__unstable__loadDesignSystem` JS API, instead of matched against a
  hand-maintained per-prefix allow-list of Tailwind's own reserved
  keywords. The allow-list approach had already needed one round of fixes
  (see `0.1.0`'s "Fixed" entry above) and still rejected `border-collapse`
  and `border-b-2`/`border-b-0` the moment `Table` and `Tabs` needed them,
  forcing a `style`-based `borderCollapse` and an inset `box-shadow`
  standing in for a real border in place of both. Compiling the real thing
  has zero false positives by construction — verified against all six
  utilities this package has now had rejected across two rounds — while
  still catching an invented token class (`bg-surface-elevated`) exactly as
  before. The raw `var(--ui-*)`/`var(--color-*)` check stays list-based
  against `TOKENS`, since Tailwind can't validate those; scoping the class
  scan to the three syntactic shapes above (rather than any class-shaped
  substring anywhere in a file) also structurally eliminates the previous
  version's `--ui-border-hairline`-contains-`border-hairline` collision,
  with no blanking pass needed to work around it.
- `Table`'s `border-collapse` and `Tabs`' selected-tab underline restored to
  real Tailwind classes (`border-collapse`; `border-b-2` with a
  transparent/accent border color, always applied to avoid a 2px layout
  shift on selection) now that the redesigned `token-parity.test.ts` no
  longer rejects either.

- The `views` layer: `ErrorView`, `AuthView` — the final rung of this
  package's component ladder (`atoms` → `blocks` → `views`, with `shell` as
  the frame `views` fill), and deliberately a short one. `ErrorView` is a
  full-page error state (404, 500, 403); it composes `blocks/EmptyState`
  rather than reimplementing it, renders the status code as real text in
  the page's own `<h1>`, and takes an optional `details` slot rendered
  inside a native `<details>`, collapsed by default. `AuthView` is a
  full-page authentication shell (sign-in, sign-up, reset, verify): a
  centered card, built on `atoms/Card`, with named `brand`/`heading`/
  `form`/`secondaryAction`/`footnote` slots. `AuthView` implements no
  authentication of any kind — no provider, no form state, no validation,
  no submit handling — it renders the consumer-supplied `form` slot exactly
  as given, the same one-way boundary `Dialog`'s `trigger` slot and
  `EmptyState`'s `action` slot already establish. `ListView`, `FormView`,
  and `DashboardView` are deliberately NOT shipped: by this package's own
  "can one page contain two of them?" test (README, "Placement rules",
  test 3), a page can hold two lists or two forms side by side, so those
  are blocks a consumer composes, not views this package pre-assembles.
- `./views` subpath export, alongside `./atoms`, `./blocks`, and `./shell`.
- `src/ladder.test.ts` extended for the complete ruleset: `views` may
  import `atoms` and `blocks` (proven by two new sanity checks, the same
  shape as the existing `blocks`-imports-`atoms` and `shell`-imports-`atoms`
  ones); no file under `src/views/` may import `shell/` — the mirror image
  of `shell/` never importing `views/`, making `views` and `shell` mutually
  exclusive peers that both build on `atoms`/`blocks` without depending on
  each other. Verified by hand that the new `views`-importing-`shell` check
  actually fails closed: a temporary import from `views/` into `blocks/`
  was added, confirmed to fail the corresponding existing test, then
  reverted.

### Fixed

- `token-parity.test.ts` no longer false-positives on Tailwind's own
  non-token utility keywords (`text-center`, `border-b`, `mx-auto`,
  `text-inherit`, `bg-transparent`, and more — see the new
  `ALLOWED_SUFFIXES` allow-list, verified against a real
  `@tailwindcss/cli@4.3.3` compile) or on a token's own property name
  containing a Tailwind-class-shaped substring (`--ui-border-hairline`
  matching as if it were a `border-hairline` class). Both false positives
  had forced real workarounds: `EmptyState` had dropped `text-center` for
  a flex-only centering approach, `Shell` had moved several classes into
  inline `style`, and — the most serious instance — `Shell` had abandoned
  the `--ui-border-hairline` token entirely for a hardcoded `"1px"`. All
  three are restored.
- `Button`, `Switch`, and `Checkbox` no longer silently drop a
  consumer-supplied `style` prop. Each set `style` unconditionally via a
  render-prop function; a `style` object or function passed by a consumer
  is now merged in, with the consumer's values winning on conflict — the
  same precedence `className` already had via `cx`/`tailwind-merge`.

### Added

- Six more blocks — `Form`, `FieldGroup`, `ConfirmDialog`, `Toolbar`,
  `NavGrid`, `SectionHeader` — completing the `blocks` layer at twelve
  components. `Form`
  is a form's own layout (an optional heading, the fields region, an
  error-summary region, an actions region) and implements NO validation
  logic or form state of its own: react-aria-components already carries
  per-field validation, and most consumers layer their own form library
  on top, so a shared component that tried to own either would need an
  escape hatch for every consumer using a different one. Its error
  summary is the real accessibility payoff — `role="alert"` plus a
  programmatic focus move onto the region itself the moment a new,
  non-empty `errors` array is passed, with each entry a real
  `<a href="#fieldId">` linking straight to its field. `FieldGroup` groups
  a related set of fields under a real `<fieldset>`/`<legend>` pair (not
  `role="group"`/`aria-labelledby` — see its own README section for why),
  with a `layout` prop (`"single" | "multi"`) for the fields' own grid.
  `ConfirmDialog` is `Dialog` composed with a fixed heading/message/
  Cancel-Confirm-actions shape — the deliberate follow-up `Dialog`'s own
  section already called out; `tone="destructive"` never relies on colour
  alone (the confirm button's own label, not just its `danger` styling,
  is what has to name the action), and default focus lands on Cancel for
  a destructive confirmation (the safer action) versus Confirm otherwise.
  It implements no imperative `confirm()` API — a `trigger` slot, exactly
  like `Dialog`. `Toolbar` builds on react-aria-components' own `Toolbar`
  primitive (shipped in the installed `react-aria-components@1.20.0`) for
  real roving-focus arrow-key navigation between `leading`/`search`/
  `trailing` slot contents, rather than a hand-rolled `role="toolbar"`.
  `NavGrid` renders a responsive grid of navigation cards from
  `{ id, title, description?, icon?, href? | onSelect? }` data; each card
  is a real `<a>` (this package's own `Link`, `variant="standalone"`) or
  `<button>` (`Button`, `variant="ghost"`) — never a `<div>` with an
  `onClick` — with the whole card, not just the title, as the click/
  keyboard target. `SectionHeader` is a heading for a section WITHIN a
  page — eyebrow, title, description, actions slot — distinct from the
  once-per-page `PageHeader`: a page routinely holds several
  `SectionHeader`s, which is what makes it its own block rather than a
  `PageHeader` variant (test 3). `level` (`2 | 3 | 4 | 5 | 6`, default
  `2`) picks which heading element `title` renders as, so a page's
  document outline stays unbroken regardless of how deeply a
  `SectionHeader` is nested; it renders a plain `<div>`, not a `<header>`,
  since a bare top-level `<header>` per instance would register a second
  `banner` landmark per section — invalid document structure for a block
  a page can hold several of.
- `token-parity.test.ts`'s `KNOWN_NON_CLASS_MAPS` is unchanged by this
  release — none of the six new blocks introduce a `Record<...,
  string>` map that isn't a `*CLASSES` variant map.

### Known issues

- `Link` (an atom, out of scope for this PR) applies `outline-none` in its
  base class but no replacement focus-visible styling of any kind, unlike
  `Button`/`TextField`/every other interactive atom here — a keyboard user
  tabbing to any `Link` (including inside `Breadcrumb`, and now inside
  `NavGrid`'s own `href` cards) gets no visible focus indicator at all.
  `NavGrid` works around this locally by adding its own
  `focus:shadow-[var(--ui-ring-focus)]` to the card's `className`; `Form`'s
  error-summary links do the same. The underlying atom bug is unfixed —
  flagged here for whoever owns `src/atoms/Link.tsx` next.
