# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
block composes atoms.** `@vespeneventures/writer` already had terms (a
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
- Not ported from `@vespeneventures/designer/tokens`: the `brandable` boolean.
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

First release. This package is the writer role, recut from
`@vespeneventures/copy` per
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
  `@vespeneventures/writer/voice-record.template.jsonc` export subpath.
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`, following the convention the operation packages adopted in
  #417. A consumer reading the installed package should not have to leave it
  to find out what changed; a new package should be born with the current
  convention rather than inheriting its donor's gap.

### Changed from `@vespeneventures/copy`

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
- Self-referential `@vespeneventures/copy` package-name mentions in doc
  comments — including the `/voice` subpath — were updated to
  `@vespeneventures/writer`, the same treatment `strategist` gave its own
  self-references to `@vespeneventures/strategy`.

### On the donor, and why it is not deprecated yet

> **Current lifecycle note:** `@vespeneventures/copy` and
> `@vespeneventures/surface` are now retired. This release note records their
> state at 0.1.0; the lifecycle contract is the authority for current
> availability.

`@vespeneventures/copy` stays `published` for now. It cannot be marked
deprecated while `@vespeneventures/surface` still declares it as a runtime
dependency — `check:package-governance` reports a lifecycle finding for a live
package depending on a deprecated one, and it is right to. The donors are
deprecated once `publisher` replaces `surface` and depends on this package
instead.

This is a deferral with a trigger, not an omission.

### Not included

- **No forwarding stub in the donor.** `@vespeneventures/copy` is
  deprecated-and-retained: still installable for a consumer already pinned
  to it, with no re-export pointing here. A stub would keep the old name
  importable, and a supersession check could then never reach zero — the
  forwarding layer would defeat the gate built to prove the swap completed.
