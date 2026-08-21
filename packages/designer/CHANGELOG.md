# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

- **No forwarding stub in the donor.** `@vespeneventures/ui` is
  deprecated-and-retained: still installable for a consumer already pinned to
  it, with no re-export pointing here. A stub would keep the old name
  importable, and a supersession check could then never reach zero — the
  forwarding layer would defeat the gate built to prove the swap completed.
