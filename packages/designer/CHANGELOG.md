# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

## [0.4.17] - 2026-09-21

### Added

- Master brand mark contract on `@clossys/designer/tokens`: `MasterMark`
  (lockup, mark-only, and inverse SVG documents), `validateMasterMark`,
  and `iconMarkSvg` aligned with the `Icon` atom and design tokens (closes
  #1109). This package does not ship a product logo.

### Changed

- README: state that `designer-environment-check` is an internal-consistency
  check with no close condition; contract-level exemption slot blocked on
  issue #906 (closes #447).

## [0.4.16] - 2026-09-21

### Added

- `SectionFrame` block: full-bleed marketing section with `ground`, `measure`
  (`content` | `wide` | `prose`), page padding, and a measured inner column.
  Long-form and stat compositions render inside it instead of host `className`
  wrappers (`data-designer-section-frame` marks framed regions).
- `ground` on `SiteFooter`, `SiteHeader`, `Shell.Header`, and `Shell.Footer`
  (`base` | `inverse`) — inverse plates use the same surface/ink tokens as
  grounded content blocks.

### Changed

- `ArticleBody` no longer sets its own max width; measure comes from
  `SectionFrame` (`measure="prose"`). Marks `data-designer-requires-section-frame`.
- Replaced 15 physical inline-direction utilities in `atoms/` and `blocks/`
  with logical equivalents for correct RTL layout (#951).

## [0.4.15] - 2026-09-21

### Changed

- Packed skill: expression-wave ownership — greyscale token contract,
  consumer brand overlay binding, and with Writer the in-tree page document;
  do not invent a brand against derivation law, treat Publisher as the
  assembler, or seal surfaces.
- Packed skill: name `MarketingView`, `SectionedView`, or a registered
  web template before filling bands; do not author a page shape the
  shipped views cannot hold. Refs: #1027.

## [0.4.12] - 2026-09-21

### Added

- `theme-keys.css` export: Tailwind `@theme` utility keys without `:root`
  primitives — for consumers who already ship a token root (issue #1051).
- `getAuthoredThemeInitScript()` stamps the authored day register before
  first paint; `getStoredThemeInitScript()` is the opt-in OS/storage path
  for product chrome (issue #1065).
- `MarketingChapter` block: marketing-scale chapter titles (`text-h2`) with
  a prose slot (issue #1058).
- `Hero` `composition` prop (`editorial` default, `split` opt-in): passing
  `media` no longer implies a two-column product-shot layout (issue #1062).
- `designer-environment-check surface [scan-dir]`: fails dual primitive
  stacks, dual Designer CSS roots, and marketing `SectionHeader` misuse
  (issues #1055, #1060).
- Display signature tokens (`--font-display-style` through `--font-display-scale-x`,
  `--ui-width-display-max`)
  and `max-w-display` utility; display headings cap measure without host CSS
  copies (issue #1052).

### Changed

- `Hero` display headings use the packaged display signature and measure cap.

## [0.4.11] - 2026-09-21

### Changed

- PRE-AUTH-QUALITY: bounded taste pass after floor gates are green — `designer-fold-check` precondition, screenshot inputs, separate session from the doer, at most 3 inhabit rounds or 45 minutes wall clock, no doer self-certify of exceptional keep. Deliverability of good (3) stays fixtures and CLIs, not longer skills.
- Packed `clossys-designer` skill Pre-auth section points at that contract (Writer and Publisher skills updated in-tree; pack on their next bumps).

## [0.4.10] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.4.9] - 2026-09-21

### Added

- `@clossys/designer/tokens` re-exports `checkTypeRecord`, `parseTypeRecord`,
  `checkTypeRecordOverlay`, and the brand-type record types so consumers can
  validate an authored type brief without importing `src/type-record/` paths.

## [0.4.8] - 2026-09-20

### Added

- `PRE-AUTH-QUALITY.md`: star scale (3 good / 4 great / 5 exceptional); done is 5; gates prove 3 only. Exceptional is a synthetic user, first person, fresh look — not a Designer or Writer self-review, not a Publisher seal, not a QA checklist.
- `designer-hero-css-check` bin: fails when a built stylesheet is missing
  Hero/Button utility rules (`text-display-l`, `font-display`, `bg-accent`,
  `rounded-control`, `tablet:grid-cols-2`).
- `designer-fold-check` bin: validates fold measurement JSON (H1 not clipped,
  no overlays on the fold, exactly one primary CTA, closed `heroMediaKind`);
  `--also` for an additional viewport file.
- `designer-type-check` bin, `templates/brand-type.template.json`, and the
  brand-type record schema (`--overlay` requires non-empty `--font-display`).
- `designer-brand-check --also <path>`: refuses when an extra stylesheet
  redeclares a brandable slot with a different value than the overlay.

### Changed

- `styles/compiled.css` is generated from `src/atoms/`, `src/blocks/`, and
  `src/shell/` so the default `tokens.css` + `compiled.css` path styles
  pre-auth Hero and shell without Tailwind.

## [0.4.7] - 2026-09-19

### Fixed

- Removed a stray comment-terminator sequence (`*/`) from CSS comment
  text in `styles/tokens.css`. A comment listing token families read
  `--color-surface-*/--color-ink-*`; the `*/` inside it terminated the
  comment early, so the rest of the comment block was parsed as
  declarations and broke the file for strict CSS parsers (Turbopack).
  Rewritten as `--color-surface-* or --color-ink-*` in both affected
  comments; no token name, value, or meaning changed.

## [0.4.6] - 2026-09-18

### Added

- Documented installation against the public npm registry
  (`https://registry.npmjs.org`) and that installing needs no authentication.
- Stated the charter close condition in the README: independent consumer
  evidence of `design conformance rate`, computed by
  `assessDesignConformanceRate()`. An empty evaluated set is
  indeterminate, never a perfect rate of 1. `designer-token-check`,
  `designer-brand-check`, `designer-contrast-check`, and
  `designer-environment-check` remain the gates they are; none is this
  rate.
- Declared `foundry.assessment` against a new mapped `designer-rate-check`
  bin with `invocation: "single-json-input"`. The four existing designer
  bins remain gates and are not the assessment surface. Advisor remains
  the only required first-day role.
- `designer-rate-check assessment.json`: prints the `design conformance
  rate` report and exits on the `0` / `1` / `2` ternary.

### Notes

- This does not claim the position is closed. Qualification of `0.4.6` is
  deferred under #833.

## [0.4.5] - 2026-09-16

### Fixed

- `DataTable`'s loading-skeleton row (`SkeletonCell`, in
  `blocks/DataTable.tsx`) rendered its `animate-pulse` class with no
  `motion-reduce:animate-none` override — the one miss in an otherwise
  consistently-followed convention (`atoms/Skeleton.tsx`,
  `atoms/ProgressBar.tsx`, and every other motion-bearing class in this
  package already pair the two). A consumer with `prefers-reduced-motion:
  reduce` set saw a pulsing skeleton row on every `DataTable` in a loading
  state. `SkeletonCell` now carries `motion-reduce:animate-none` like
  every other animated class this package ships.
- `README.md`'s "Optional-peer version guards" section claimed, unqualified,
  that "every atom accepts a `className` prop." `FileTrigger` does not, by
  design (react-aria-components' own `FileTrigger` hardcodes its hidden
  input's `className` to `""` and discards whatever is passed — see
  `FileTrigger.tsx`'s own header) — and the README already documented that
  exception correctly everywhere else. Only this one unqualified line
  contradicted it; it now names the exception instead of overclaiming.

### Changed

- `public-contract.test.ts`'s reduced-motion test asserted "every shipped
  animation or transition" but checked that claim against a hand-written
  list of ten files — a list that cannot notice a new motion site, which
  is exactly how the `DataTable` gap above shipped unnoticed (the same
  mechanism #907 is about). The test now scans `src/{atoms,blocks,shell,
  charts,theme}` for `animate-`/`transition-` class literals and checks
  every file it finds, the same file-discovery pattern `ladder.test.ts`
  and `peer-guard-coverage.test.ts` already use elsewhere in this package.
- `peer-guard-coverage.test.ts`'s `react`-peer coverage test (#182) checked
  a hand-written array of five `*/index.ts` barrels only. Designer has
  nine real `assertPeerVersion` call sites, not five: each `*/server.ts`
  is its own `exports` subpath (`@clossys/designer/charts/server`, etc.)
  a consumer can import without ever loading its sibling `index.ts`, so a
  guard wired only into `index.ts` left four call sites completely
  unpinned. The barrel set is now derived from `package.json#exports`
  itself and checked against built `dist/` output — what a consumer
  actually resolves — rather than `src/`. `theme/server.ts` deliberately
  ships no guard (`getThemeInitScript` has no runtime `react` dependency
  at all); the new test confirms that by reading dist rather than special-
  casing the file path out of its coverage. Designer's half of #903.

## [0.4.4] - 2026-09-15

### Fixed

- The internal `cx()` class-merge helper — reachable from every atom, and
  therefore from the server-safe barrels (`atoms/server`, `blocks/server`)
  too — used to `import` `tailwind-merge` STATICALLY. `tailwind-merge` is
  declared an OPTIONAL peer in this package's own `peerDependenciesMeta`,
  so a consumer who (correctly) did not install it got
  `Cannot find package 'tailwind-merge'` the moment any server-safe import
  touched `cx`, even on a render path that never mentioned styling. `cx`
  now resolves `tailwind-merge` via a dynamic import inside a `try`/`catch`,
  so importing a subpath no longer throws on this peer's absence, and
  still uses the full token-aware merge whenever it is installed. See
  `atoms/internal/cx.ts` and `atoms/internal/cx.optional-peer.test.ts`
  (#749).

### Changed

- When `tailwind-merge` is genuinely absent, `cx()` renders with a plain,
  unmerged class join instead of resolving conflicts — two conflicting
  Tailwind utilities passed to the same `cx(...)` call (a built-in default
  and a consumer's own override, say) are now BOTH present in the
  rendered `className`, and which one is visually applied depends on
  Tailwind's generated stylesheet order rather than on argument order.
  This is not silent: `cx()` logs one `console.warn` per process (not per
  call) the first time it actually happens, naming the cause. See the
  README's "Optional-peer version guards" section.

## [0.4.3] - 2026-09-14

### Changed

- Patch version bump only, to obtain a fresh, never-before-used
  `governance/release-qualifications/` record path. The 0.4.2 qualification
  record added by #811 was orphaned when that pull request was squash-merged
  (#821) and had to be removed (#834); the immutability gate that protects
  already-introduced record paths (`check-candidate-qualification.mjs`'s
  single-introduction-commit invariant) means a valid record can never again
  be introduced at the `0.4.2` path, so this package moves to `0.4.3`
  purely to regain one. No functional or behavioral change.


## [0.4.2] - 2026-09-09

### Changed

- Historical entries below now describe the previous npm scope without naming
  the producer account this catalogue no longer publishes under, and links to
  this repository use its current `clossys/foundry` path. No date, version,
  or recorded fact changed — only the way the retired scope is referred to.


## [0.4.1] - 2026-09-02

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.4.0] - 2026-09-02

### Added

- Made `StatusList`'s `groups` prop optional and added a sibling `items`
  prop: a flat array of the same row shape, rendered as a single `dl` with
  no group heading at all. Provide exactly one of the two. A grouped list
  (`groups`) renders exactly the markup it always did — one heading and one
  `dl` per group — so this is additive for every existing caller; `items` is
  the only new rendering path.

## [0.3.1] - 2026-09-01

### Fixed

- Declared the four CLI bin targets in the form npm actually publishes, without
  a leading `./`. npm rewrote those values during packing, so the manifest in
  the tarball disagreed with the manifest in the tree and publish qualification
  refused the candidate. The normalised values are byte-identical to what
  0.2.7 already carries on the registry, so no installed CLI path moves.

### Note on 0.3.0

0.3.0 was never published. It carried the additive SectionedView slots below
and was withdrawn before release when the bin-map defect was found. Everything
0.3.0 added ships in 0.3.1 unchanged; the number is skipped rather than reused
because a released version is immutable and this candidate's packed contents
changed after qualification.

## [0.3.0] - 2026-09-01

### Added

- Added an optional `detail` slot to every `StatusList` row, readiness and
  off-axis disposition alike. It renders as a second description of the same
  term, so a row's own explanation, including the reasoning behind a
  `not-offered` answer, stays inside the definition-list semantics rather than
  becoming a paragraph that only looks adjacent. A row had nowhere to put that
  reasoning before but its own label.
- Added the optional `eyebrow` slot `Hero` and `FeatureGrid` already shipped
  to `Faq` (both the React Aria and server-native implementations),
  `OrderedStepSequence`, and `StatusList`. A small label above the block
  heading is now expressible on every editorial block rather than on two of
  them. A block given no eyebrow, heading, or description still renders no
  heading region at all.

Both slots are optional and additive: a call that compiled and rendered under
0.2.7 compiles and renders identically under 0.3.0, and a block passed neither
slot emits the markup it always did. This is a minor rather than a patch
because 0.x caret and tilde ranges are minor-locked, so a consumer that wants
either slot widens its declared range deliberately.

## [0.2.7] - 2026-09-01

### Added

- Added the separately closed `StatusList` `not-offered` disposition for
  deliberate non-capabilities outside the readiness axis. It uses a neutral
  tone rather than reading as a warning or future commitment.

## [0.2.6] - 2026-08-31

### Added

- Added server-safe `OrderedStepSequence` and `StatusList` editorial blocks
  with ordered and definition-list semantics, caller-localized labels,
  closed state and ground vocabularies, accessible authored ordinals,
  responsive decorative connectors, and explicit contrast coverage.
- Added the server-safe, closed `SectionGround` contract (`base`, `sunken`,
  `inverse`) and Designer-owned class/token mapping. `Hero`, `FeatureGrid`,
  both `Faq` implementations, `OrderedStepSequence`, and `StatusList` now
  apply their own matching surface, foreground, divider/connector, and status
  treatment rather than requiring a consumer to paint around them.

### Fixed

- Replaced the five bounded physical-direction shell patterns with logical
  inset, border, and focus-position utilities so navigation, drawers, toasts,
  and skip links follow the document writing direction.

## [0.2.5] - 2026-08-31

### Changed

- Prepared a bounded trusted-publisher patch source for provenance after the owner-present first publication and anonymous registry verification. This change does not publish the package or claim provenance.

## [0.2.4] - 2026-08-31

### Fixed

- Added `Faq` to `@clossys/designer/blocks/server` with a native
  `details`/`summary` implementation. The ordinary blocks entry continues to
  use React Aria, while server consumers receive the same public props without
  reaching the client-only dependency graph. The native summary retains its
  stateful disclosure marker and uses the package-standard focus-visible
  outline without the `outline-none` custom-property override that would
  prevent Tailwind's generated outline width from painting. The same
  conflicting reset was removed from Banner's dismiss control.

## [0.2.3] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.2.2] - 2026-08-29

### Security

- Replaced three backtracking token parsers with deterministic scanners so
  hostile malformed OKLCH, token-alias, and CSS-comment input is handled in
  linear time without changing valid parsing behavior.

## [0.2.1] - 2026-08-24

### Fixed

- Updated README guidance to active Publisher and Writer packages after the
  predecessor packages retired.

## [0.2.0] - 2026-08-21

### Added

- **The `environment-conformance` gate**, closing
  [issue #405](https://github.com/clossys/foundry/issues/405) as
  narrowed by that issue's own correction comment once
  [issue #358](https://github.com/clossys/foundry/issues/358) routed
  the full module-graph resolver elsewhere: `render-environment.ts` has
  exported `RENDER_ENVIRONMENT` — a plain record declaring each
  `package.json#exports` subpath `"server-safe"` or `"client-only"` — since
  this package's first release, but nothing ever verified it stayed in step
  with the manifest it describes. A subpath could be added to, removed
  from, or renamed in `package.json#exports` with no matching edit to the
  record, or vice versa, and nothing would notice.
  - **`checkEnvironmentConformance(packageRoot)`** (new export from
    `@clossys/designer/gate`) checks that `RENDER_ENVIRONMENT`'s key
    set and `package.json#exports`' subpath set are the SAME SET, in both
    directions — nothing more. It performs NO module resolution and does
    not verify that a `"server-safe"` subpath actually resolves safely
    under a real export condition; that real verification is
    [issue #358](https://github.com/clossys/foundry/issues/358)'s
    shared `builder` capability, deliberately not built twice here. A
    `"satisfied"` verdict means the declaration is internally consistent
    with the manifest — it says nothing about whether the declaration is
    true of the compiled output. Returns a three-state verdict:
    `"satisfied"` (the two sets agree, over at least one subpath, never
    "no error was thrown"), `"violated"` (every `undeclared-subpath` and
    every `stale-declaration` reported, each naming its own direction, not
    collapsed into one "mismatch"), or `"indeterminate"` with a
    machine-readable reason (manifest missing/unparseable, no or an empty
    `exports` map, the declaration missing/unparseable, or the
    declaration-loading subprocess failing).
  - **`designer-environment-check [package-dir]`**, a new installable
    `bin`, exits `0`/`1`/`2` for satisfied/violated/indeterminate.
  - **The adversarial proof this gate is built to pass, asserted in one
    test over one fixture** (`environment-conformance.adversarial.test.ts`):
    the named weaker tool — a bare COUNT comparison, "N keys on each side,
    so they must agree" — exits `0` on a fixture where one subpath was
    RENAMED (never added or removed), because the count is unchanged on
    both sides. The real gate, spawned as the compiled CLI by its compiled
    path (the same way this repository invokes every gate), exits `1` on
    the identical fixture, because the renamed-to name is undeclared and
    the renamed-from name is now a stale declaration — a defect a count
    can never see.

## [0.1.0] - 2026-08-21

First release. This package is the designer role, recut from
the previous scope's `ui` package per
[decision 10](../../docs/DECISIONS.md#10-recutting-the-expression-surface-into-role-shaped-packages).

This changelog starts here rather than carrying the donor's history, which
cites decisions and issues that would mean nothing — or the wrong thing — to a
reader who arrives at this package first.

### Added

- A complete visual system: design tokens, theme CSS, accessible React
  components (`atoms`, `blocks`, `shell`, `charts`, `theme`), icon glyph data,
  and three visual-quality gates — unchanged from the donor.
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`, following the convention the operation packages adopted in
  #417. A consumer reading the installed package should not have to leave it
  to find out what changed; a new package should be born with the current
  convention rather than inheriting its donor's gap.

### Changed from the previous scope's `ui`

- **The package is named for the job, not the artifact.** The role's
  exclusive question is *is it well made?* A name that describes a thing
  rather than a doer is an artifact, and an artifact belongs inside a role.
- **All three bins are renamed for the role, not the artifact:**
  - `ui-token-check` → `designer-token-check` (the CLI for `checkTokenPurity`)
  - `tokens-brand-check` → `designer-brand-check` (the CLI for
    `checkBrandFileCoverage`)
  - `ui-contrast-check` → `designer-contrast-check` (the CLI for
    `checkTokenContrast`)

  Each keeps the `<role>-<job>-check` shape the donor already used
  (`ui-token-check`, `ui-contrast-check`) or is brought into it
  (`tokens-brand-check` was named for the layer it lives in, `tokens/`, not
  the role that runs it); only the leading segment moves from the artifact
  name to the role name. The job words after the dash — `token`, `brand`,
  `contrast` — are domain vocabulary the gates actually check and are left
  alone, matching decision 10's rule that renaming the role does not rename
  what it reasons about.
- **Nothing else was renamed.** `tokens`, `atoms`, `blocks`, `shell`,
  `charts`, `theme`, `RENDER_ENVIRONMENT`, `checkTokenPurity`,
  `mergeUiClasses`, and every other exported symbol, CSS custom property, and
  file name keep their names. A sweep that also renamed the vocabulary would
  have made the diff unreviewable while changing no behaviour.
- **The peer-version guard's source comment is strengthened, not just
  copied.** `internal/peer-version.ts` mirrors the donor's local ternary
  (never imported from `@clossys/controller`) exactly, but its header
  now records both reasons that copy must stay a copy — this package sits at
  or below `@clossys/controller` in build order, and `controller`
  itself cannot re-export the type because `gates/secret-gates.ts` already
  imports its own `internal/peer-version.js`, which would create a cycle —
  and states plainly that consolidating the (now six) identical copies into
  one shared import is a regression, not cleanup. The guard's own behaviour,
  including its deliberate fail-open inversion of this repository's
  fail-closed gate contract and the named cost that buys (a genuinely
  incompatible peer whose version string cannot be parsed proceeds silently),
  is unchanged from the donor.

### Not included

> **Current lifecycle note:** the previous scope's `ui` is now retired. This
> release note records its state at 0.1.0; the lifecycle contract is the
> authority for current availability.

- **No forwarding stub in the donor.** The previous scope's `ui` is
  deprecated-and-retained: still installable for a consumer already pinned to
  it, with no re-export pointing here. A stub would keep the old name
  importable, and a supersession check could then never reach zero — the
  forwarding layer would defeat the gate built to prove the swap completed.
