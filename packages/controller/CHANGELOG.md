# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - Unreleased

### Added

- Skill registry `scope` is now a closed, three-value enum: `account`
  (operates on one account's own repository inventory), `repo` (operates
  inside a single repository), and `third-party` (vendored from an external
  source; has no owning account). There is deliberately no fourth,
  "machine" or plane-spanning, tier — a skill encodes judgment about a
  specific inventory someone actually reviewed, and "the machine" has no
  inventory of its own to have judgment about. See
  `conventions/documents/skill-grammar.md` and
  `conventions/documents/skill-registry.md`.
- Three new adapter files under `./conventions/adapters/*`:
  `heavy-cmd-hook.sh` (resource-discipline preflight hook),
  `scoped-main-push.sh` (default-branch protection and branch provenance
  inside a discovered canonical workspace tree), and `workspace-shell.zsh`
  (generic interactive workspace-navigation helpers). All three are
  account-neutral: configured entirely through the environment, with no
  operator path, account name, or topology baked in.

### Changed

- **Breaking:** the registry validator now hard-rejects two previously
  accepted `scope` values instead of silently normalizing or vaguely
  rejecting them. `"plane"` (this registry's own former name for the tier
  now called `"account"`) and `"workspace"` (an independent name a
  different consuming account had settled on for the identical concept)
  both now fail validation with a `registry/legacy-scope` finding whose
  message names `"account"` as the replacement. The former `"repository"`
  value is rejected the same way, naming `"repo"`. `RegisteredSkill` also
  drops the separate `thirdParty` boolean now that `scope: "third-party"`
  carries the same fact in the one field that already decided a skill's
  identity.

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
