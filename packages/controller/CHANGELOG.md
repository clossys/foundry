# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - Unreleased

### Fixed

- **`reconcileLiveState` (`./conventions`) now compares `declaredAt`/
  `liveObservedAt` as instants, not as strings (#313).** The doc comments on
  both fields require only "ISO 8601," which permits UTC offsets other than
  `Z` and optional fractional seconds; two valid ISO 8601 values could
  therefore compare in the wrong direction as plain strings (for example,
  `"2026-08-10T09:00:00+02:00"`, 07:00 UTC, sorted lexicographically *after*
  `"2026-08-10T08:00:00Z"`, 08:00 UTC, even though it names an earlier
  instant). This was the sole trigger for the
  `live-artifact-predates-its-declaration` finding, so with mixed offsets
  that finding could silently fail to fire, or fire when it should not.
  Both timestamps are now parsed with `Date.parse` and compared as epoch
  instants. A `declaredAt`/`liveObservedAt` that is present but cannot be
  parsed as an instant now returns `could-not-verify` (reason
  `declared-but-not-verifiable`, with a blocker naming which field and
  value could not be parsed) instead of silently proceeding as though
  temporal ordering had been checked and found clean.

### Documentation

- `conventions/documents/live-state-reconciliation.md` now says a
  declaration names **five** things, matching the five fields it actually
  lists (`store`, `readableByScript`, `readableBy`, `reconciledBy`, `note`);
  it previously said four.
- `live-state-reconciliation.md`, `routine-declaration.md`, and
  `schedule-declaration.md` now distinguish the `could-not-verify`
  **outcome** from `declared-but-not-verifiable`, its machine-readable
  **reason**, and state explicitly that `could-not-verify` covers both a
  read that was never attempted and a read that was attempted and reported
  a blocker mid-attempt (an API returning 500, a permission refused) — not
  only a surface that is unreadable in principle.
- The README's `liveStateSurface` section now states the mapping from this
  module's `verified` / `drifted` / `could-not-verify` vocabulary to
  `GateResult`'s own `satisfied` / `violated` / `indeterminate` verdict
  literals explicitly, rather than leaving a reader to infer it from the
  tests.

## [0.3.0] - Unreleased

### Added

- **`./conventions` gains the canonical `liveStateSurface` contract (#255):**
  `LIVE_STATE_SURFACE_FINDING_KINDS` (all five finding kinds, including
  `declared-but-not-verifiable`), `LiveStateSurfaceDeclaration` and
  `validateLiveStateSurfaceDeclaration`, `reconcileLiveState`, and the three
  outcome constructors `liveStateVerified` / `liveStateDrifted` /
  `liveStateCouldNotVerify`. This consolidates a shape that had already been
  reimplemented independently in `@vespeneventures/builder` and
  `@vespeneventures/observer`, plus this package's own tier-specific
  `reconciliationFindingKinds` (`./routines.ts`) and
  `scheduleReconciliationFindingKinds` (`./schedules.ts`): `controller` owns
  every rule those two vocabularies already specialize and has no dependency
  of its own, so it is the shape's one canonical home. Neither tier-specific
  validator's behaviour changed.
- New shipped convention document,
  `conventions/documents/live-state-reconciliation.md`, naming the shared
  contract once: a declaration of intent, a live state owned elsewhere, a
  reconciliation surface that may not exist yet, and the three-state outcome
  (verified / drifted / could-not-verify) that keeps "nobody looked" from
  reading as "looks fine." `routine-declaration.md` and
  `schedule-declaration.md` now each cross-reference it as the shape their
  own finding vocabulary specializes.

## [0.2.1] - Unreleased

### Fixed

- **`branch-provenance-hook.sh` and `scoped-main-push.sh` no longer treat an
  unset required `AGENT_BRANCH_PREFIX` as allow.** Both hooks signal their
  decision on stdout; exiting 0 with empty stdout is read by the caller as
  "allow." With the variable unset, both hooks printed a stderr line saying
  "refusing to run unconfigured" and then did exactly the opposite — exited
  with no stdout, permitting the very branch creation or default-branch push
  they exist to block, while the log read as if the guard had run and
  refused. This is live, not theoretical: `scoped-main-push.sh` used to
  hardcode its prefix, so it always evaluated; parameterizing it for
  publication removed the hardcoded value without giving the unset case a
  safe direction, so any consumer moving from a hardcoded local copy to the
  published one loses default-branch protection silently unless something
  else happens to set the variable — and the variable comes from the agent
  product's own hook registration, which a consuming repository does not own
  and cannot set for its operator (issue #307).

  The fix has two parts:

  1. When `AGENT_BRANCH_PREFIX` is unset, the branch-provenance naming rule
     (the only rule that reads the variable) now emits an `ask` decision —
     the same JSON shape these hooks already use for `deny` — naming the
     missing variable and stating that the rule cannot evaluate without it,
     instead of exiting silently. `ask` was chosen over an unconditional
     `deny`: it keeps the guard's decision in a human's hands rather than
     dropping it, and it does not make every branch creation in an
     unconfigured install fail outright the way `deny` would — which in
     practice tends to get a hook deleted rather than configured, the
     opposite of what a default-branch guard is for.
  2. Default-branch push protection in both files never actually read
     `AGENT_BRANCH_PREFIX` — only the branch-naming rule does. Both hooks
     previously exited before reaching the push check at all whenever the
     variable was unset, which is the actual mechanism behind the silent
     allow. Push protection is now fully decoupled from that variable and
     stays enforced (`deny`/`ask`, exactly as when configured) regardless of
     whether `AGENT_BRANCH_PREFIX` is set.

  The misleading comment directly above the old unset-handling code (which
  asserted a safety property — "refusing to guess is the point" — that the
  code did not have) is rewritten to describe what the code actually does.

  `heavy-cmd-hook.sh`'s unrelated advisory degrade-open behavior (an unset
  or unresolvable `HEAVY_CMD_PREFLIGHT_COMMAND` prints a warning and
  continues) is unchanged and now carries a comment recording why: it is a
  resource-discipline preflight, not a protection boundary, so continuing on
  missing configuration is the correct default there — the difference from
  the two hooks above is a recorded decision, not two scripts that happen to
  differ.

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
