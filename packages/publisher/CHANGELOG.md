# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.8] - 2026-08-31

### Fixed

- Added a `react-server` target for `@clossys/publisher/web`. Its runtime
  exports match the ordinary target, while `MarketingView`, `AuthView`, and
  `ErrorView` resolve only Designer's server-safe barrels and the server FAQ
  renders as native `details`/`summary`. Ordinary imports retain the React
  Aria FAQ. The runtime dependency floor is now `@clossys/designer ^0.2.4`,
  the first release that exports `Faq` from its server-safe blocks barrel.

## [0.1.7] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.6] - 2026-08-30

### Fixed

- Corrected exact-pin consumer guidance to require Writer `0.3.x`, matching
  this package's real `@clossys/writer ^0.3.0` runtime dependency, rather
  than directing a clean consumer to the incompatible historical `0.2.x`
  line.

## [0.1.5] - 2026-08-29

### Security

- Replaced the ambiguous OKLCH argument and numeric-token regular expressions
  with single-pass scanners, so hostile malformed public input is rejected in
  linear time without changing valid color conversion behavior.

## [0.1.4] - 2026-08-24

### Fixed

- Updated README references to the active Strategist package and corrected
  historical donor availability with a lifecycle note.

## [0.1.3] - 2026-08-21

### Changed

- Widened the declared `@vespeneventures/writer` dependency range from
  `^0.2.0` to `^0.3.0`. `writer` 0.3.0 (issue #373) added the passage
  layer — `checkPassageComposition`, `readPassageRecord`, the
  `writer-check passages` CLI subcommand, and their supporting types — a
  purely additive feature, not a patch; `^0.2.0` does not resolve `0.3.0`
  (0.x ranges are minor-locked), so the old declared range would have kept
  this package pinned to the superseded release. No source in this
  package imports the new passage-layer surface; this is purely picking
  up the new range.

## [0.1.2] - 2026-08-21

### Changed

- Widened the declared `@vespeneventures/writer` dependency range from
  `^0.1.0` to `^0.2.0`. `writer` 0.2.0 (issue #407) changed
  `writer-check addressability`'s exit-code precedence — a real violation
  now wins over an incomplete scan — which is a behavioural contract
  change, not a patch; `^0.1.0` does not resolve `0.2.0` (0.x ranges are
  minor-locked), so the old declared range would have kept this package
  pinned to the superseded precedence. No source in this package imports
  `checkAddressability` or otherwise depends on the changed behaviour
  directly; this is purely picking up the new range.

  This release is `0.1.2` rather than `0.1.1` because the `designer`
  widening below took `0.1.1` first, on a branch developed in parallel with
  this one. Both widenings are carried here together. Resolving that
  collision by keeping only one side would have shipped this package with
  the other range still pointing at a superseded version, and no gate would
  have failed — an un-widened range still resolves against the older
  published release, so it would simply never widen.

## [0.1.1] - 2026-08-21

### Changed

- **Widened the `@vespeneventures/designer` dependency range to `^0.2.0`.** A
  runtime dependency range is shipped content, so it moves this package's
  version even though no code here changed. See
  [issue #405](https://github.com/vespeneventures/foundry/issues/405), which
  added `designer`'s `environment-conformance` gate
  (`designer-environment-check`, `checkEnvironmentConformance`) and bumped
  `designer` to `0.2.0`.

## [0.1.0] - 2026-08-21

First release. This package is the publisher role, fused from two donors —
`@vespeneventures/surface` (the composer half) and `@vespeneventures/ledger`
(the record half) — per
[decision 10](../../docs/DECISIONS.md#10-recutting-the-expression-surface-into-role-shaped-packages).
The role's exclusive question: *did we put it out to an audience, and can we
prove what shipped?*

This changelog starts here rather than carrying either donor's history,
which cites decisions and issues that would mean nothing — or the wrong
thing — to a reader who arrives at this package first.

### Added

- Surface composition, media registries, and channel renderers for web,
  email, print, images, and slides, plus a product-neutral
  structured-document contract — unchanged from `@vespeneventures/surface`,
  under the same eight subpaths: `./core`, `./media`, `./web`, `./document`,
  `./email`, `./print`, `./image`, `./slides`.
- An append-only, content-addressed record of what was published, to which
  channel, when, citing which facts, plus a drift checker and a join-key
  completeness checker — unchanged from `@vespeneventures/ledger`, now under
  a ninth subpath, `./record`.
- Two bins: `publisher-media-check` (the composer's media-registry gate) and
  `publisher-record-check` (the record's drift/append-only/join-key gates,
  with `append-only` and `join-key` reachable as subcommands). Both dispatch
  on `argv[0]`/`argv[1]` matching exactly — never on
  `basename(process.argv[1])`, which would see `cli.js` and silently run the
  wrong command wherever a gate is invoked by compiled path, the same
  convention every other package in this repository's rename series holds
  to.
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`, following the convention the operation packages adopted in
  #417. A consumer reading the installed package should not have to leave it
  to find out what changed; a new package should be born with the current
  convention rather than inheriting either donor's gap.

### Why one package, not two

`publisher` is one package, not two, for a reason stated in decision 10 and
worth restating here: composition without a record is unprovable, and every
time the publisher runs, the record runs — there is no publish that
legitimately skips it. That argues for one install and one version, which
one package with a `./record` subpath delivers.

The measurement that originally argued for splitting `surface` and `ledger`
into two packages is accommodated, not overturned: **the record shares no
code with the composer and does not import it, in either direction.**
`./record`'s own source imports only `@vespeneventures/controller/policy`
and its own relative files; nothing under `./core`, `./media`, `./web`,
`./document`, `./email`, `./print`, `./image`, or `./slides` imports
anything under `./record`, or vice versa. Fusing the *packaging* was never
the same as fusing the *dependency graph*, and only the second would have
cost anything. A publication record is a DOCUMENT the composer never
imports.

### Changed from `@vespeneventures/surface` and `@vespeneventures/ledger`

- **The package is named for the job, not the artifact.** The role's
  exclusive question is *did we put it out to an audience, and can we prove
  what shipped?* A name that describes a thing rather than a doer is an
  artifact, and an artifact belongs inside a role.
- **Seven import specifiers repointed, verified against the real `exports`
  maps of their new targets, not assumed:**
  - `@vespeneventures/copy` → `@vespeneventures/writer` (writer's `"."`
    export)
  - `@vespeneventures/copy/voice` → `@vespeneventures/writer/voice`
    (writer's `"./voice"` export)
  - `@vespeneventures/ui` → `@vespeneventures/designer` — **not actually
    imported anywhere in the composer's source**; `@vespeneventures/ui` has
    no `"."` export either in the donor or in `designer`, and grepping
    `surface/src` turned up zero real (non-comment) imports of the bare
    specifier. Listed for completeness; nothing to repoint.
  - `@vespeneventures/ui/atoms` → `@vespeneventures/designer/atoms`
    (designer's `"./atoms"` export)
  - `@vespeneventures/ui/blocks` → `@vespeneventures/designer/blocks`
    (designer's `"./blocks"` export)
  - `@vespeneventures/ui/shell` → `@vespeneventures/designer/shell`
    (designer's `"./shell"` export)
  - `@vespeneventures/ui/tokens` → `@vespeneventures/designer/tokens`
    (designer's `"./tokens"` export)

  All prose (doc-comment) mentions of `@vespeneventures/copy` and
  `@vespeneventures/ui` — not just real `import` statements — were updated
  the same way, the same treatment `writer` and `designer` gave their own
  self-references.
- **The bins are `publisher-media-check` and `publisher-record-check`, not
  `surface-media-check` and `ledger-check`.** Same two programs, renamed to
  match the role. `publisher-record-check` keeps `ledger-check`'s two
  subcommands (`append-only`, `join-key`) unchanged — only the bin name
  moved, never the dispatch logic or the subcommand names, since those name
  what each gate checks, not who runs it.
- **Nothing else was renamed.** `SurfaceDocument`, `ComposeDocument`,
  `renderWebDocument`, `AssetEntry`, the whole `media`/`web`/`document`/
  `email`/`print`/`image`/`slides` vocabulary, and — on the record side —
  `PublicationEntry`, `Ledger`, `FactCitation`, `appendEntry`,
  `checkLedgerDrift`, `checkAppendOnly`, `checkJoinKeyCompleteness`, all keep
  their names. A role owns artifacts; renaming the role does not rename what
  it composes or what it records. A sweep that also renamed the vocabulary
  would have made the diff unreviewable while changing no behaviour.
- Self-referential `@vespeneventures/surface` and `@vespeneventures/ledger`
  package-name mentions in doc comments were updated to
  `@vespeneventures/publisher` (and, where the mention was specifically
  about the record half, `@vespeneventures/publisher`'s `./record`
  subpath) — the same treatment `strategist`, `writer`, and `designer` gave
  their own self-references. A citation of a donor BY NAME, describing
  provenance (e.g. "recut from `@vespeneventures/surface`"), is left as-is —
  that is a historical fact, not a stale specifier.
- **Dependencies changed shape, not just name.** `surface` declared
  `@vespeneventures/copy` (`~0.10.0`) and `@vespeneventures/ui` (`~0.15.0`);
  `ledger` declared `@vespeneventures/controller` (`~0.8.0`). This package
  declares `@vespeneventures/writer` (`^0.1.0`), `@vespeneventures/designer`
  (`^0.1.0`), and `@vespeneventures/controller` (`~0.8.0`, unchanged range).
  `writer` and `designer` are caret ranges because they are fresh `0.x` role
  packages starting at `0.1.0`; `controller` stays a tilde range, carried
  over unchanged from `ledger` — a caret range on a `0.x` package is
  patch-only under semver and has broken this repository's CI before.
  `./record` continues to import only `@vespeneventures/controller/policy`,
  never `@vespeneventures/controller/gates`, which drags a runtime
  TypeScript import this package has no reason to take on.

### On the donors, and why neither is deprecated yet

> **Current lifecycle note:** `@vespeneventures/surface` and
> `@vespeneventures/ledger` are now retired. This release note records their
> state at 0.1.0; the lifecycle contract is the authority for current
> availability.

`@vespeneventures/surface` and `@vespeneventures/ledger` both stay
`published` for now. Neither can be marked deprecated while nothing else in
this repository has moved to depend on `publisher` instead — the donors
deprecate together, once `publisher` is what the rest of the workspace
actually depends on. `check:package-governance` enforces that a live
package cannot depend on a deprecated one; deprecating either donor before
that migration would trip it for anyone still consuming `surface` or
`ledger` directly.

This is a deferral with a trigger, not an omission.

### Not included

- **No forwarding stub in either donor.** `@vespeneventures/surface` and
  `@vespeneventures/ledger` remain independently installable, with no
  re-export pointing here. A stub would keep the old names importable, and a
  supersession check could then never reach zero — the forwarding layer
  would defeat the gate built to prove the swap completed.
- **No new coupling between the two halves.** `./record` does not import
  `@vespeneventures/writer` or `@vespeneventures/designer`; nothing under
  `./core`, `./media`, `./web`, `./document`, `./email`, `./print`,
  `./image`, or `./slides` imports `./record`. Fusing the packaging was a
  decision about install/version granularity, never about the dependency
  graph.
