# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- Initial release: the verbal contract, peer to `@vespeneventures/tokens`'
  visual contract.
- **Schema** (`src/types.ts`): plain TypeScript types (no schema library —
  see "Requirements" in the README) for `VoiceRecord` — `rules` (`person`,
  `tense`, `formality`, `tone`), `glossary` (forbidden/preferred terms),
  and `claims` (a claims register with an optional `factRef` seam into a
  future `strategy` package's `facts` registry — never a code dependency
  on it).
- **Shape validation** (`src/schema.ts`): `validateVoiceRecordShape` —
  hand-rolled type-guard validation, in the style of
  `@vespeneventures/policy`'s own `validate.ts`, producing this
  repository's own `rule`/`severity`/`message`/`path` finding shape — and
  `parseVoiceRecord` (fail-fast, throws with every issue listed).
- **The checker** (`src/checker.ts`): `checkCopy(record, copy, options?)`.
  Catches forbidden glossary terms, forbidden person/tense word-markers,
  and claims made in copy that lack a `factRef` while `requiresSupport` is
  true. Person/tense word-list matching is case-insensitive, with one
  automatic exception: a single uppercase letter (in practice, `"I"`) is
  matched case-sensitively, so it cannot collide with an unrelated
  lowercase letter. Fails closed on empty copy and on any dimension with
  nothing configured to check against, recording each as an explicit
  `skipped` entry rather than a silent, empty-findings pass. Ships an
  explicit, auditable waiver mechanism (`options.waivers`) scoped to one
  `rule` + one finding `path` at a time, requiring a non-empty `reason`,
  and surfacing an unused waiver as its own `"waiver:unused"` warning.
  `auditClaimsRegister(claims)` — a pure, copy-free audit of a claims
  register for missing `factRef`s.
- No runtime dependencies — matching `@vespeneventures/catalog`,
  `@vespeneventures/policy`, and `@vespeneventures/tokens`'s own precedent.
- Full test coverage in `src/*.test.ts`, entirely hermetic: every fixture
  is an inline literal (an obviously fictional placeholder voice), no
  filesystem or network access anywhere in the suite.
