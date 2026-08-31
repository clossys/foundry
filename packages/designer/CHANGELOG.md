# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
  [issue #405](https://github.com/vespeneventures/foundry/issues/405) as
  narrowed by that issue's own correction comment once
  [issue #358](https://github.com/vespeneventures/foundry/issues/358) routed
  the full module-graph resolver elsewhere: `render-environment.ts` has
  exported `RENDER_ENVIRONMENT` — a plain record declaring each
  `package.json#exports` subpath `"server-safe"` or `"client-only"` — since
  this package's first release, but nothing ever verified it stayed in step
  with the manifest it describes. A subpath could be added to, removed
  from, or renamed in `package.json#exports` with no matching edit to the
  record, or vice versa, and nothing would notice.
  - **`checkEnvironmentConformance(packageRoot)`** (new export from
    `@vespeneventures/designer/gate`) checks that `RENDER_ENVIRONMENT`'s key
    set and `package.json#exports`' subpath set are the SAME SET, in both
    directions — nothing more. It performs NO module resolution and does
    not verify that a `"server-safe"` subpath actually resolves safely
    under a real export condition; that real verification is
    [issue #358](https://github.com/vespeneventures/foundry/issues/358)'s
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
`@vespeneventures/ui` per
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

### Changed from `@vespeneventures/ui`

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
  (never imported from `@vespeneventures/controller`) exactly, but its header
  now records both reasons that copy must stay a copy — this package sits at
  or below `@vespeneventures/controller` in build order, and `controller`
  itself cannot re-export the type because `gates/secret-gates.ts` already
  imports its own `internal/peer-version.js`, which would create a cycle —
  and states plainly that consolidating the (now six) identical copies into
  one shared import is a regression, not cleanup. The guard's own behaviour,
  including its deliberate fail-open inversion of this repository's
  fail-closed gate contract and the named cost that buys (a genuinely
  incompatible peer whose version string cannot be parsed proceeds silently),
  is unchanged from the donor.

### Not included

> **Current lifecycle note:** `@vespeneventures/ui` is now retired. This
> release note records its state at 0.1.0; the lifecycle contract is the
> authority for current availability.

- **No forwarding stub in the donor.** `@vespeneventures/ui` is
  deprecated-and-retained: still installable for a consumer already pinned to
  it, with no re-export pointing here. A stub would keep the old name
  importable, and a supersession check could then never reach zero — the
  forwarding layer would defeat the gate built to prove the swap completed.
