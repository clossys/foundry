# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-08-20

First release. This package is the strategist role, recut from
`@vespeneventures/strategy` per
[decision 10](../../docs/DECISIONS.md#10-recutting-the-expression-surface-into-role-shaped-packages).

This changelog starts here rather than carrying the donor's history, which
cites decisions and issues that would mean nothing — or the wrong thing — to a
reader who arrives at this package first.

### Added

- Dependency-free validators for a consumer's own strategy records: facts,
  mission, positioning, markets, audiences, roadmap, and brand
  essence/attributes/derivations.
- `readStrategy`, a typed reader over a consumer's strategy directory.
- Three gates, all reachable from the single `strategist-check` bin: the
  facts-traceability gate (default invocation), `brand-coverage`, and
  `direction`. Each dispatches on `argv[0]` matching exactly — never on
  `basename(process.argv[1])`, which would see `cli.js` and silently run the
  wrong command wherever a gate is invoked by compiled path.
- Zero runtime dependencies, unchanged from the donor.

### Changed from `@vespeneventures/strategy`

- **The package is named for the job, not the artifact.** The role's exclusive
  question is *is it true, and is it us?* A name that describes a thing rather
  than a doer is an artifact, and an artifact belongs inside a role.
- **The bin is `strategist-check`, not `strategist-facts-check`.** The donor's
  bin name predates the CLI growing `brand-coverage` and `direction`
  subcommands, so it named one of three jobs while advertising itself as the
  package's entry point.
- **Nothing else was renamed.** `readStrategy`, `StrategyBundle` and the
  `strategy-dir` argument keep their names. Renaming the role does not rename
  what the role reasons about, and a sweep that also renamed the vocabulary
  would have made the diff unreviewable while changing no behaviour.

### Not included

- **No forwarding stub in the donor.** `@vespeneventures/strategy` is
  deprecated-and-retained: still installable for a consumer already pinned to
  it, with no re-export pointing here. A stub would keep the old name
  importable, and a supersession check could then never reach zero — the
  forwarding layer would defeat the gate built to prove the swap completed.
