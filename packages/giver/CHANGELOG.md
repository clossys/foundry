# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.4] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `giver-check` would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.1.3] - 2026-08-31

### Changed

- Prepared a bounded trusted-publisher patch source for provenance after the owner-present first publication and anonymous registry verification. This change does not publish the package or claim provenance.

## [0.1.2] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.1] - 2026-08-22

Pre-publication contract correction. No `0.1.0` tarball reached the registry.

### Changed

- The versioned `./record` surface now also declares the retained decision
  grounds document. Each ground names the opaque subject it concerns,
  allowing `keeper` to prove the person can reach it without importing
  `giver` or duplicating the record.

## [0.1.0] - 2026-08-22

First release. This package is the giver role: everything about what you
get — what you asked for, and what we owe you.

This changelog starts here rather than carrying the donor's history, which
cites decisions and issues that would mean nothing — or the wrong thing —
to a reader who arrives at this package first.

### Added

- A verdict that is a **ternary**: `delivered`, `refused`, `handed off`.
  Never a binary, because a binary cannot tell a request given to a person
  apart from a request quietly dropped.
- `decideOutcome`, the one decision, and the one place the precedence rule
  between a standing refusal and a thing we owe is resolved. Every one of
  its collaborators is a required field: "nothing is owed" is written
  `owed: null`, "no human is free" is written
  `{ available: false, namedReason }`. There is no `?.` and no `??`
  anywhere in the decision path.
- `evaluateObligation`, returning the obligation ternary — `discharged`,
  `breached`, `unprovable` — where a recorded send whose own state says it
  failed is a breach, and a send nobody observed the outcome of is
  unprovable rather than done.
- Three gates, all reachable from the single `giver-check` bin:
  `handoff-placement`, `grounding`, and `obligation-discharge`. Each
  dispatches on `argv[0]` matching exactly — never on
  `basename(process.argv[1])`, which would see `cli.js` and silently run
  the wrong command wherever a gate is invoked by compiled path.
- The `0` / `1` / `2` exit contract, with `2` reachable on every gate by
  more than one route — an unreadable or invalid record store, an empty
  record set, a set in which nothing has yet come due, an outcome that
  could not be established, a required declared value that was not
  supplied, and no gate selected at all — and each route tested. A bare
  `giver-check` exits `2`: nothing was selected, so nothing was checked.
  Only an explicitly requested `--help` exits `0`.
- A `./record` subpath carrying the **document seam**: a declared filename,
  a declared schema, and a reader that turns a missing, unparseable or
  invalid document into an `unreadable` standing read rather than a
  permissive one. Plus `answerRecordFor` and `handoffRecordFor`, which turn
  one verdict into exactly the records the gates read back — including the
  hand-off record behind a refusal that could not be placed, which would
  otherwise vanish and leave an unanswered person looking like a clean row.
- `src/collaborators.check.ts`, a compile-time proof that `OutcomeInputs`
  has zero optional keys, that `DeliveryBasis` has no variant meaning "we
  could not tell", and that `VerdictRefusalGrounds` has none either.
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`: a consumer reading the installed package should not have
  to leave it to find out what changed.

### Design notes

- **The defect this package repays.** A send path in this workspace reads
  its policy collaborator as `(await config.policy?.(message)) ?? { outcome:
  "allow" }` — an optional collaborator defaulting to a positive outcome,
  so a host that wires nothing sends everything to everyone with no error
  anywhere. Nothing here can be written that way, and the reason is
  structural rather than advisory: the collaborator is required, and the
  positive outcome has no value that could stand for "unknown".
- **Both collapses are unexpressible, not merely discouraged.** An
  indeterminate read cannot become a delivery, because every `DeliveryBasis`
  variant is a positive reason to send. It also cannot become a bare
  refusal, because every `VerdictRefusalGrounds` variant is either the
  person's own standing decision or a hand-off that could not be placed —
  and the second carries the hand-off record with it. The second collapse
  is the more dangerous one: it looks like discipline while real requests
  are dropped and the refusal metrics stay healthy.
- **A hand-off is the only outcome that needs a human, and if no human is
  available the outcome is a refusal — never a delivery.** The refusal
  names its reason and carries the hand-off that could not be placed, so
  the placement gate reports it as raised and never picked up.
- **An attempt is not a delivery.** The discharge gate reads the observed
  state of each proof rather than counting sends. Three recorded attempts
  that all failed are three proofs and zero deliveries.
- **`--at` has no default, on either gate that needs it.** A gate that read
  its own clock could never be replayed, and whether a record is late would
  depend on when someone happened to look.
- **No service level and no window are invented here.** Both are declared
  per record by the consumer, and a missing one is a validation failure
  rather than a value this package chose.

### Not included

- No obligation, no register, no category, no jurisdiction logic, and no
  values of any kind. The consumer declares its own obligation register.
  No claim of legal compliance is made anywhere.
- No record here holds the text of a request, an answer, a refusal, or a
  message. Grounds are referenced by opaque id and proofs by an opaque
  transport reference.
- No person-attributable record is written into this repository.
  `subjectId` and `actorId` are opaque host-owned references carrying no
  email, name, phone number, address, or IP, and they are separate
  identifiers in every signature.
