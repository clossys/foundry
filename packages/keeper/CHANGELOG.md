# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1] - 2026-08-22

Pre-publication contract correction. No `0.1.0` tarball reached the registry.

### Changed

- Visibility now reads `giver`'s versioned retained-grounds JSON document
  across a document seam. Grounds stay owned by `giver`; an unreachable one
  has its own finding kind, and neither package imports the other.

## [0.1.0] - 2026-08-22

First release. This package is the keeper role: everything about what you gave
us, and what we understand from it.

Greenfield — there is no donor. Nothing in this workspace owned this before,
so this changelog starts at the beginning rather than carrying a history that
would cite decisions and issues meaning nothing to a reader who arrives here
first.

### Added

- A verdict that is a **ternary**: `held`, `forgotten`, `unjustifiable`.
  `decideHolding` resolves the precedence between an erasure the person asked
  for, an account they closed, a retention their consumer declared, a holding
  that traces to nothing, and one they cannot see or correct — in that order,
  and in one place.
- **Every reason to keep something names the source event it came from.** All
  six `HoldingBasis` variants carry a `sourceEventId`, so a holding justified
  by "legacy", "imported", or "it was already there" has no shape to be
  written in.
- **The boundary rule, as a type.** An instruction constrains us; an
  understanding only informs us. `BeliefUse` has two modes, and the
  constraining one requires a `confirmation` field written explicitly — a real
  confirmation, or `null` on purpose. The third shape, a constraint where the
  question never came up, is unconstructable.
- Three gates, all reachable from the single `keeper-check` bin:
  `attribution`, `visibility`, and `disposal`. Each dispatches on `argv[0]`
  matching exactly — never on `basename(process.argv[1])`, which would see
  `cli.js` and silently run the wrong command wherever a gate is invoked by
  compiled path.
- The `0` / `1` / `2` exit contract, with `2` reachable on every gate by more
  than one route — an unreadable or invalid record store, an empty holding
  set, an answer that could not be established, a required declared value that
  was not supplied, and no gate selected at all — and each route tested. A
  bare `keeper-check` exits `2`: nothing was selected, so nothing was checked.
  Only an explicitly requested `--help` exits `0`.
- A `./web` subpath carrying the **showing step**: `useHeldRecord` reads
  everything held about one person, renders a verdict per item with the same
  `decideHolding` the gates use, and exposes correction and erasure through
  the same call shape as reading. An erasure the host could not confirm leaves
  the row on screen with its observed effect reported. Its React peer is
  optional and asserted at import time.
- `src/justification.check.ts`, a compile-time proof that every holding basis
  names a source event, that a constraining belief cannot omit its
  confirmation field, that `HeldItem` and `HoldingInputs` have zero optional
  keys — and that every could-not-tell value stays writable.
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`: a consumer reading the installed package should not have to
  leave it to find out what changed.

### Design notes

- **The adversarial case the disposal gate exists for.** A weaker tool checks
  that a retention policy exists, reads a well-formed schedule, and passes —
  while records sit far past it, because nothing compared the declaration
  against the data. Declaration present, drift unmeasured. This gate joins
  each item to the rule its own class declared and compares ages in days, and
  reports an item whose class the schedule never covered as unverifiable
  rather than clean.
- **The rule lives in the arithmetic, not only in the validators.** Every
  comparison here is a strictly-greater test, and `NaN > n` is `false`, so an
  unparseable instant flowing through the maths would read as "inside its
  schedule" and count toward the satisfied answer. The validators refuse one
  at the JSON boundary, but the checkers are exported and take any record a
  host builds directly, so `elapsedDays` returns `undefined` rather than `NaN`
  and every caller routes that to the adverse or the indeterminate answer.
- **`disposal` has two violation reasons, kept apart.** A set whose only fault
  is erasure residue did not outlive its schedule, and reporting it under
  `items-retained-past-schedule` would send a reader to inspect a schedule
  that is working. `DISPOSAL_VIOLATION_REASONS` is exported so the CLI derives
  its exit code from the list rather than restating either name.
- **On a closed account, succession wins the basis.** Including over an
  inferred belief, whose own basis it replaces: `successorSubjectId` is the
  only place the fact that somebody inherited the material survives. The
  boundary rule is still judged first, so a constraint the person never agreed
  to is not laundered by being inherited.
- **Indeterminate must be representable, and it never rounds to satisfied.**
  These gates output judgements, so "I could not check" is the most important
  thing one can say. All three have a per-record indeterminate route as well
  as an empty-set one, and every one exits `2`. A mixed run reports the
  indeterminate reason and still prints the violation it found.
- **The verdict fails closed rather than carrying a fourth variant.** A
  holding whose source could not be verified is `unjustifiable`, never `held`.
  Eliminating indeterminacy from a judgement would be wrong; eliminating an
  unjustified holding from the set of things that can be *kept* is the point.
- **Reading is not correcting.** `correctable` is a separate required field
  from `reach`, never derived from it. A surface that shows a person a belief
  about them they cannot change looks like transparency and is not.
- **The join is on the subject, not the actor.** The person acting and the
  person acted about are routinely different, and a record shown to the wrong
  person is reported by name rather than counted as visibility.
- **`--at` has no default.** A gate that read its own clock could never be
  replayed, and whether a record has outlived its schedule would depend on
  when someone happened to look.

### Not included

- No retention period, no holding class, no belief class, no disclosure
  surface, no jurisdiction logic and no values of any kind. The consumer
  declares its own retention schedule and its own belief classes. No claim of
  legal compliance is made anywhere.
- **No store.** `HoldingStore`, `DisclosureDirectory` and `SourceEventLedger`
  are host-supplied ports with no implementation shipped, because git cannot
  delete and this role must. Nothing here writes anything, anywhere, and no
  person-attributable record is ever written into a repository.
- No record here holds authored material, saved work, or a belief's own
  wording. Everything is an opaque id and a consumer-defined label.
  `subjectId` and `actorId` carry no email, name, phone number, address, or
  IP, and they are separate identifiers on every record.
