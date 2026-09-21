# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## [0.1.7] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.1.6] - 2026-09-18

### Added

- Stated the charter close condition in the README: independent consumer
  evidence of `confirmed current intent rate`, computed by
  `assessConfirmedCurrentIntentRate()`. An empty evaluated set is
  indeterminate, never a perfect rate of 1. `checkConfirmationCompleteness`
  and `checkCurrency` remain the gates they are; neither is this rate.
- Declared `foundry.assessment` against a new mapped `butler-rate-check`
  bin with `invocation: "single-json-input"`. `butler-check` remains the
  three-gate CLI and is not the assessment surface. Advisor remains the
  only required first-day role.
- `butler-rate-check assessment.json`: prints the `confirmed current intent
  rate` report and exits on the `0` / `1` / `2` ternary.

### Notes

- This does not claim the position is closed. Qualification of `0.1.6` is
  deferred under #833.

## [0.1.5] - 2026-09-17

### Fixed

- Removed a doc-comment citation in `src/schema.ts` that pointed at a
  repository-root agent-policy file. `src/` is packed content and compiles
  into `dist/`, so that comment reached an installed consumer while the file
  it named did not: `files` carries `dist`, `src`, this changelog, the README
  and the licence, and nothing from the repository root. The sentence now
  states the hand-rolled-validation convention on its own, which is the part
  a reader of the installed package can actually act on. No type, export,
  signature, or runtime behaviour changed.

## [0.1.4] - 2026-09-16

### Fixed

- The Install section told a consumer this package requires a GitHub
  personal access token with `read:packages`, pointing at the repository
  root README for confirmation. That pointer led to a section describing
  an unrelated, still-token-gated set of packages — corroborating evidence
  for a claim that has never been true of `@clossys/butler`, which
  publishes to `https://registry.npmjs.org` with public access and
  installs anonymously. A reader following the instruction as written
  would create a credential this package never asks for. (#924)


## [0.1.3] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `butler-check` would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.1.2] - 2026-08-31

### Changed

- Prepared a bounded trusted-publisher patch source for provenance after the owner-present first publication and anonymous registry verification. This change does not publish the package or claim provenance.

## [0.1.1] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.0] - 2026-08-21

First release. This package is the butler role: everything about what a
person wants, now and standing.

This changelog starts here rather than carrying either donor's history,
which cites decisions and issues that would mean nothing — or the wrong
thing — to a reader who arrives at this package first.

### Added

- A want schema in three states, not two: `absent`, `denied`, and
  `granted`, plus a `stale` evaluation status that is computed and never
  stored. Absence is a value, so it can never be read as permission.
- `evaluateStandingInstruction`, which compares one stored answer against
  the policy version in force **and** the clock. A row that exists, says
  `granted`, and is a year past its own declared window comes back `stale`.
- `decideStandingChange` plus `recordReopened` and `recordStaleness`: the
  pure decision core and the audit-event builders. Actor and subject are
  separate parameters and separate fields, always, and
  `src/audit-shape.check.ts` fails the build if the audit event ever gains
  a personal-data-shaped key or loses that separation.
- Three gates, all reachable from the single `butler-check` bin:
  `confirmation-completeness`, `currency`, and `withdrawal-parity`. Each
  dispatches on `argv[0]` matching exactly — never on
  `basename(process.argv[1])`, which would see `cli.js` and silently run
  the wrong command wherever a gate is invoked by compiled path.
- The `0` / `1` / `2` exit contract, with `2` reachable on every gate by
  more than one route — an unreadable or invalid record store, an empty
  record set, a required declared value that was not supplied, and no gate
  selected at all — and each route tested. A bare `butler-check` exits `2`:
  nothing was selected, so nothing was checked. Only an explicitly
  requested `--help` exits `0`.
- An `./inbound` subpath: admission on any channel as a pure function of
  the caller's own signature verification and a host ledger's dedupe
  answer. An unreachable ledger rejects rather than acknowledging, because
  acking an event whose dedupe never ran would silently discard it.
- A `./web` subpath: `useStandingWants`, a currency-aware preference-surface
  hook whose `withdraw` shares `grant`'s and `deny`'s exact call shape.
  React is an optional peer, asserted at import time by `assertPeerVersion`
  so an absent or incompatible version fails loudly and by name.
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`: a consumer reading the installed package should not have
  to leave it to find out what changed.

### Design notes

- **Confidence is a first-class value with a declared floor.** An intent
  carries its confidence on the record, and the floor is supplied by the
  caller with no default anywhere in this package. A reading below the
  floor may be confirmed or handed off; what it may never be is acted on
  silently, and `handed-off` is a first-class disposition precisely so
  declining to act is representable as a decision rather than as an
  absence of one.
- **An inferred standing instruction is not binding until confirmed.** It
  evaluates to `absent`, with its own reason, so relying on it is a
  finding rather than a pass.
- **The currency window has no default.** A window this package invented
  would be this package authoring one of the consumer's own values, and a
  missing window silently read as "forever" is the open loop the currency
  gate exists to close.
- **`invalidateDenialOnPolicyBump` has no default in either direction.**
  Whether a policy bump invalidates a prior refusal is a jurisdiction
  judgment, and this package answers no jurisdiction questions.

### Not included

- No topic vocabulary, no jurisdiction logic, no obligations, and no
  values of any kind. Storage and audit are host-supplied ports and no
  implementation of either ships here. No claim of legal compliance is
  made anywhere.
- No person-attributable record is written into this repository. `subjectId`
  and `actorId` are opaque host-owned references carrying no email, name,
  phone number, address, or IP.
