# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Added

- First release of `@vespeneventures/controller`, formed by merging three
  packages into one (issue #282, program issue #281): `@vespeneventures/governance`
  (`0.15.0`) — package lifecycle, catalog, gates, release, repository,
  review, cleanup, and composition — `@vespeneventures/conventions`
  (`0.8.0`) — account-neutral agent conventions — and
  `@vespeneventures/policy` (`0.1.0`) — the content-addressed binding
  primitive. Every subpath previously reachable under the three old package
  names resolves unchanged under `@vespeneventures/controller`: this is a
  rename and a merge, not a rewrite, and no public API was redesigned.
- New subpaths: `./conventions` (governance's own `./gates`, `./repository`,
  etc. carry over unchanged), `./conventions/documents/*`,
  `./conventions/adapters/*`, and `./policy`.
- `@vespeneventures/governance`, `@vespeneventures/conventions`, and
  `@vespeneventures/policy` are deprecated. `governance` and `policy` remain
  published as thin compatibility stubs forwarding here (their own
  compatibility-shim consumers — `catalog`, `gates`, `release`,
  `repository`, `review`, and, outside this program, `ledger` and
  `verify-standards` — would otherwise be stranded); `conventions` had no
  installed consumer and is retired outright, with no compatibility stub.
  See [`docs/DECISIONS.md`](../../docs/DECISIONS.md#9-consolidating-governance-conventions-and-policy-under-controller).
  Issue #288 removes the `governance` and `policy` stubs once the migration
  window closes.

See `@vespeneventures/governance`'s own historical changelog (this package's
former name, before issue #282) for this source's history before the merge.
