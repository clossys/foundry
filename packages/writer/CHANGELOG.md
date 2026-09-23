# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

## [0.3.16] - 2026-09-23

### Changed

- Packed skill: cite the strategist handoff — an audience id, approved
  claim ids (`claim:<id>`), applicable constraint ids (`constraint:<id>`),
  and the current direction id. Do not edit `strategy/`. Refs: #1120.

## [0.3.15] - 2026-09-21

### Changed

- Packed skill: expression-wave ownership — with Designer, author the in-tree
  page document; do not invent strategy facts, treat yourself as
  outline-only for Publisher to finish, or publish surfaces.
- Packed skill: name `MarketingView`, `SectionedView`, or a registered web
  template before filling bands; do not author a page shape the shipped
  views cannot hold. Refs: #1027.

## [0.3.14] - 2026-09-21

### Added

- `writer-check addressability` classifies inline prose in object-literal
  chrome config (`label`, `title`, `cta`, `caption`, `heading`, `kicker`,
  `body`, `description`, `aria-label`, and nested `items`/`nav`/`links`
  entries) as violations with file and key path. Allowlisted keys (`href`,
  `to`, `path`, `icon`, …) and route-shaped values are not copy surfaces.

### Fixed

- Non-copy object-literal string keys stay in the unchecked bucket unless
  allowlisted or flagged as copy violations.

## [0.3.13] - 2026-09-21

### Changed

- Packed skill Pre-auth section: bounded taste pass after `designer-fold-check` is green (see PRE-AUTH-QUALITY, the brief that ships with `@clossys/designer`).

## [0.3.12] - 2026-09-21

### Added

- `writer-check addressability --chrome <file>` (repeatable): scan
  consumer-declared persistent chrome (site header, footer, skip link, nav
  labels) in addition to `scan-dir`. `--require-chrome` refuses to run when
  no chrome file was declared.
- Treatment-level word budgets: registry entries may declare `treatment` and
  optional `maxWords`. `writer-check` fails when approved copy exceeds the
  budget (built-in defaults for `display-heading`, `eyebrow`, and `button`).
- `writer-check --render-registry <file>`: must be the same file as
  `record-file` after realpath. The default command requires `record-file` to
  be a `CopyRegistry` — the store `createCopyResolver` reads at render, not
  a plain `CopyRecord` or a second in-memory-only store.

## [0.3.11] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.3.10] - 2026-09-20

### Added

- `writer-check --live <dir>` (repeatable) with `--voice-record`: scans
  declared live-copy trees for claim-shaped and magnitude-shaped prose not
  covered by the voice claims register.
- Live-copy scan also flags built-in fold wallpaper phrases (`fold-wallpaper`).
- Skill: a 5 keep is a synthetic user, not a Writer self-review of copy.
- `writer-check addressability --extensions <ext>` (repeatable): scan
  additional file extensions beyond the default `.ts`/`.tsx`/`.js`/`.jsx`
  set.
- README: documents `--extensions` and that this repository's own CLI prose
  is operator messaging, not a copy-registry subject for addressability.

## [0.3.9] - 2026-09-18

### Added

- Documented installation against the public npm registry
  (`https://registry.npmjs.org`) and that installing needs no authentication.
- Stated the charter close condition in the README: independent consumer
  evidence of `approved copy coverage rate`, computed by
  `assessApprovedCopyCoverageRate()`. An empty evaluated set is
  indeterminate, never a perfect rate of 1. `checkCopyRecord` and
  `checkCopyTraceability` remain the gates they are; neither is this rate.
- Declared `foundry.assessment` against a new mapped `writer-rate-check`
  bin with `invocation: "single-json-input"`. `writer-check` remains the
  multi-mode CLI and is not the assessment surface. Advisor remains the
  only required first-day role.
- `writer-rate-check assessment.json`: prints the `approved copy coverage
  rate` report and exits on the `0` / `1` / `2` ternary.

### Notes

- This does not claim the position is closed. Qualification of `0.3.9` is
  deferred under #833.

## [0.3.8] - 2026-09-16

### Added

- README now documents the `writer-check --format json` contract added in
  0.3.7: the exact object shape, and the guarantee that `verdict`, `findings`
  and `unchecked` are present together on every path — clean, findings, and
  total failure alike. The flag was documented in `--help` and in this
  changelog but not in the README, where this package documents its other
  CLI exit-code contracts (#880).

### Changed

- Version bumped from 0.3.7 to 0.3.8 without a functional change to the
  shipped code. 0.3.7 was never published: its retained qualification record
  bound a tarball that could not be reproduced from the tree, because the
  record was generated against an incrementally-built `dist/` that carried
  stale artifacts. Qualification records are immutable — one introduction per
  path, hash-pinned — so the 0.3.7 record could not be corrected and 0.3.7
  could never be published. It is skipped deliberately rather than reused.

  The mechanism is filed as #893; this release's own record was generated
  from a clean build on the pinned release runtime specifically because of it.

## [0.3.7] - 2026-09-15

### Fixed

- The default `writer-check` command's scanner could not classify a `//`
  line comment or a `/* */` block comment placed BETWEEN a JSX element's
  attributes — legal TSX every mainstream formatter produces for a
  commented-out or explained prop. The attribute-parsing loop inside
  `tryScanJsxElement` had no case for either comment form, so it fell
  through to the loop's own "not committed, silently not-JSX" backtrack;
  for a NESTED element (the realistic shape in a real component tree)
  that backtrack surfaced as an `"unrecognized-jsx-child"` `unchecked`
  entry, and this package's own indeterminate-fold ("one unreadable
  region must not let a scan report itself clean") turned that ONE
  construct into exit code 2 for the WHOLE run — discarding every real
  finding the same scan had already produced (issue #753: a 270-entry
  `CopyRecord` scan against a real application tree extracted 294
  candidates, produced 292 findings, and still exited 2 over this one
  construct). Comment trivia between attributes is now skipped exactly
  like the whitespace surrounding it, before any commit decision is
  made — the same "silent, pre-commit trivia" treatment this loop
  already gives TSX's generic-arrow-function syntax.

### Added

- `writer-check --format json`: the default command's own structured,
  machine-readable report (`CopyTraceabilityReport`), matching the
  `--format json` shape `inspector`'s CLI already publishes. Exit code 2
  (indeterminate) is unchanged and still wins whenever any JSX construct
  is `unchecked` — an indeterminate result must never read as clean, and
  this does not touch that rule. What changes is that a consumer no
  longer has to choose between reading the exit code and discarding
  everything the run DID measure: `--format json` prints exactly one
  object to stdout, always carrying `verdict` (the same
  `"clean" | "findings" | "indeterminate"` states this package uses
  everywhere), `findings`, and `unchecked` together, regardless of which
  verdict resulted — so a real finding produced alongside a genuinely
  unclassifiable construct in the same run is still reachable by a
  consumer that reads past the exit code, exactly as #753 asked for,
  while a consumer that only checks `exitCode`/`verdict` still, correctly,
  never sees an indeterminate run reported as a pass.

## [0.3.6] - 2026-09-14

### Changed

- Patch version bump only, to obtain a fresh, never-before-used
  `governance/release-qualifications/` record path. The 0.3.5 qualification
  record added by #811 was orphaned when that pull request was squash-merged
  (#821) and had to be removed (#834); the immutability gate that protects
  already-introduced record paths (`check-candidate-qualification.mjs`'s
  single-introduction-commit invariant) means a valid record can never again
  be introduced at the `0.3.5` path, so this package moves to `0.3.6`
  purely to regain one. No functional or behavioral change.


## [0.3.5] - 2026-09-09

### Changed

- Historical entries below now describe the previous npm scope without naming
  the producer account this catalogue no longer publishes under, and links to
  this repository use its current `clossys/foundry` path. No date, version,
  or recorded fact changed — only the way the retired scope is referred to.


## [0.3.4] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `writer-check` would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.3.3] - 2026-08-31

### Changed

- Prepared a bounded trusted-publisher patch source for provenance after the owner-present first publication and anonymous registry verification. This change does not publish the package or claim provenance.

## [0.3.2] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.3.1] - 2026-08-24

### Fixed

- Added a current lifecycle note to the historical donor availability record.

## [0.3.0] - 2026-08-21

### Added — the passage layer (issue #373)

**A `Passage` composes `CopyEntry`/glossary-term REFERENCES the way a UI
block composes atoms.** `@clossys/writer` already had terms (a
glossary) and entries (single addressable strings) and nothing between
them — in practice nobody reuses one string; they reuse a whole
empty-state (title + body + action), a whole FAQ item (question + answer),
a whole error (message + recovery). This release adds that missing
middle: terms ≈ tokens, entries ≈ atoms, passages ≈ blocks. Documents
(the composition layer, mirroring how a view composes blocks) remain out
of scope for this release — see the issue.

- **`PassageRecord`/`Passage`** (`passage.ts`): a `Passage` has a stable
  dot-separated `id`, a required `context` (an unlocatable passage is not
  reviewable, mirroring `CopyEntry.context`'s own rule), and `fields` — a
  set of named slots (`title`, `body`, `action`, ...) each of which should
  hold a `PassageReference`: `{ ref: "entry", id }` or `{ ref: "term",
  term }`.
- **`validatePassageRecordShape`/`parsePassageRecord`** — structural
  validation, in the same dependency-free, accumulate-and-keep-going style
  every other schema in this package uses. Deliberately does NOT validate
  a field's own value shape (whether it's a literal or a reference) — see
  below.
- **`readPassageRecord`** — the one place in `passage.ts` that touches a
  filesystem; never throws, mirrors `registry.ts`'s `readCopyRecord`
  exactly.
- **`classifyPassageField`/`checkPassageComposition`** — the passage
  COMPOSITION gate, wired to a new CLI subcommand, `writer-check passages
  <registry-file>`, dispatched the identical way `writer-check
  addressability` already is (a fully separate top-level branch, its own
  exported `mainPassagesCheck`, never folded through `main()`). THE
  TERNARY:
  - **`0` (satisfied)** — every passage references only entries and
    terms, at least one passage evaluated.
  - **`1` (violated)** — a passage inlines a literal string instead of
    referencing an entry (the verbal equivalent of a hardcoded value
    instead of a token), or references another passage's own internals
    (`{ ref: "passage", ... }`) rather than composing entries/terms the
    way a block composes atoms. Wins over an incomplete picture in the
    same run — the identical "a real violation must outrank an incomplete
    scan" precedence this package's own `addressability` gate settled on
    for issue #407/#433, applied here from the start.
  - **`2` (indeterminate)** — the registry could not be
    read/parsed/validated, zero passages were registered, or a field's
    value could not be confidently classified, with zero violations found.
    Fails CLOSED with a machine-readable reason; never a silent pass.
- **What this gate deliberately does not do**: verify a referenced entry
  id or term actually exists in a real `CopyRecord`/glossary. That is a
  different, weaker question than the one this gate answers (composition
  purity: is this field a reference at all, never mind whether it
  resolves) — the same split `addressability.ts` already draws from
  `copy-gate.ts`'s traceability check. See
  `passage.adversarial.test.ts` for the proof: a weaker
  "every referenced entry id exists" tool passes a passage built entirely
  from inline literals (it has zero references to check), while
  `writer-check passages`, spawned as the compiled CLI, correctly exits 1
  on the identical fixture.
- Not ported from `@clossys/designer/tokens`: the `brandable` boolean.
  See `passage.ts`'s own top doc comment, "WHERE THE MIRROR STOPS", for
  why forcing that field into this layer would be false symmetry.

`checkPassageComposition`, `classifyPassageField`, `parsePassageRecord`,
`readPassageRecord`, `validatePassageRecordShape`, and every associated
type are exported from this package's root entry point.

## [0.2.0] - 2026-08-21

### Changed — BEHAVIOURAL, read this before upgrading (issue #407)

**`writer-check addressability`'s exit-code precedence flipped.** A run that
finds at least one violation now exits `1` REGARDLESS of how many string
positions are unclassified. Previously, any unclassified ("unchecked")
position forced exit `2` ("indeterminate") even when the same run had
already found and named real violations — and on any real tree, hundreds of
positions are token data this gate cannot classify by design, so the old
precedence made `1` unreachable outside a fixture: every real run had *some*
unclassified positions and therefore always read `2`, silently discarding
every violation it had actually found.

- **`violated` (exit `1`)** — at least one violation, regardless of
  unclassified count. The coverage gap is not hidden by this: `unchecked`
  and `reasons` are still populated and `writer-check addressability`
  still prints them unconditionally; only the verdict changed.
- **`indeterminate` (exit `2`)** — zero violations AND at least one
  unclassified position (or the tree could not be read, or zero components
  were scanned). The honest "found nothing, but did not see everything"
  case — unchanged, and still never a pass.
- **`satisfied` (exit `0`)** — zero violations, zero unclassified, over at
  least one scanned file. Unchanged.

**If your CI treats `writer-check addressability`'s exit `2` as
non-blocking or "flaky, coverage is never complete, ignore it": stop.** A
tree that used to report `2` will now correctly report `1` whenever it
contains a real violation, and that is the point of this release, not a
regression — those trees always had the violation, this exit code was
previously the only thing hiding it.

`checkAddressability`'s `AddressabilityGateResult.verdict`/`.reasons` and
`mainAddressabilityCheck`'s exit code both changed together; no other
export's shape changed. See `addressability.ts`'s top doc comment ("THE
TERNARY") and `README.md`'s "Copy addressability" section for the full
precedence.

## [0.1.0] - 2026-08-21

First release. This package is the writer role, recut from the previous
scope's `copy` per
[decision 10](../../docs/DECISIONS.md#10-recutting-the-expression-surface-into-role-shaped-packages).

This changelog starts here rather than carrying the donor's history, which
cites decisions and issues that would mean nothing — or the wrong thing — to
a reader who arrives at this package first.

### Added

- A consumer-owned language system: voice rules (glossary terms and
  regex-safe pattern rules), claims validation, addressable and
  locale-aware copy records (`CopyRegistry`, `CopyRef`), source
  traceability scanning, and computed content fingerprints.
- `readCopyRecord` and the `checkCopy` voice checker, unchanged from the
  donor.
- Four gates, all reachable from the single `writer-check` bin: the
  default traceability command, `addressability`, `voice-derivation-coverage`,
  and `locale-coverage`. Each dispatches on `argv[0]` matching exactly —
  never on `basename(process.argv[1])`, which would see `cli.js` and
  silently run the wrong command wherever a gate is invoked by compiled
  path.
- Zero runtime dependencies, unchanged from the donor.
- The `voice-record.template.jsonc` template, still reachable at the
  `@clossys/writer/voice-record.template.jsonc` export subpath.
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`, following the convention the operation packages adopted in
  #417. A consumer reading the installed package should not have to leave it
  to find out what changed; a new package should be born with the current
  convention rather than inheriting its donor's gap.

### Changed from the previous scope's `copy`

- **The package is named for the job, not the artifact.** The role's
  exclusive question is *is it well said?* A name that describes a thing
  rather than a doer is an artifact, and an artifact belongs inside a role.
- **The bin is `writer-check`, not `copy-check`.** Same program, same four
  subcommands, renamed to match the package.
- **Nothing else was renamed.** `CopyRegistry`, `CopyRef`, `checkCopyRecord`,
  `CopyEntry`, `checkCopyTraceability`, the `copy-record` vocabulary, and
  every voice/glossary/claim term keep their names. A role owns artifacts;
  renaming the role does not rename what it reasons about. A sweep that also
  renamed the vocabulary would have made the diff unreviewable while
  changing no behaviour.
- Self-referential `copy` package-name mentions in doc
  comments — including the `/voice` subpath — were updated to
  `@clossys/writer`, the same treatment `strategist` gave its own
  self-references to its own donor, `strategy`.

### On the donor, and why it is not deprecated yet

> **Current lifecycle note:** the previous scope's `copy` and
> `surface` are now retired. This release note records their
> state at 0.1.0; the lifecycle contract is the authority for current
> availability.

The previous scope's `copy` stays `published` for now. It cannot be marked
deprecated while that scope's `surface` still declares it as a runtime
dependency — `check:package-governance` reports a lifecycle finding for a live
package depending on a deprecated one, and it is right to. The donors are
deprecated once `publisher` replaces `surface` and depends on this package
instead.

This is a deferral with a trigger, not an omission.

### Not included

- **No forwarding stub in the donor.** The previous scope's `copy` is
  deprecated-and-retained: still installable for a consumer already pinned
  to it, with no re-export pointing here. A stub would keep the old name
  importable, and a supersession check could then never reach zero — the
  forwarding layer would defeat the gate built to prove the swap completed.
