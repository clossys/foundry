# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
