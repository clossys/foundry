# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - Unreleased

### Added

- **A template** (`templates/voice-record.template.jsonc`), the
  `VoiceRecord` analog of `@vespeneventures/tokens`' `brand-template.css` —
  a consumer copies it, fills in every slot, and never ships it unedited.
  JSONC, not plain JSON or a `.ts` literal: JSON alone can't carry the
  fill-in-the-blank commentary a usable template needs, and a `.ts` module
  would force every placeholder to already satisfy `VoiceRecord`'s own
  types (`formality` couldn't hold a loud sentinel, only a real
  `FormalityLevel`). `src/internal/parse-template.ts` hand-rolls the
  (string-aware) comment stripping this needs — zero new dependency, the
  same call `tokens` makes for its own CSS parsing. Shipped via a new
  `./voice-record.template.jsonc` subpath export and in `package.json`'s
  `files`.
- **The bindable/fixed split, made explicit and data-driven**
  (`src/fields.ts`'s `VoiceFieldDefinition`/`VOICE_FIELDS`) — the
  `TokenDefinition.brandable` analog for this package. **A finding, not an
  assumption:** unlike `tokens.css` (42 of 154 declared tokens are
  `brandable: true`; the rest stay their shipped value for every brand),
  every single entry in `VOICE_FIELDS` is `bindable: true` — there is no
  `VoiceRecord` field meant to stay the same value across every voice,
  because `VoiceRecord` IS the consumer-owned binding layer in its
  entirety. The fixed half of this package's contract (rule KINDS: that a
  voice has exactly a `person`/`tense`/`formality`/`tone` axis, a glossary
  entry's `status` is one of exactly two values, a claim has exactly five
  fields) lives in `src/types.ts`'s interfaces and literal unions instead —
  a different FILE, not a `bindable: false` entry in this one. See
  `fields.ts`'s header comment for the full accounting.
- **A two-way coverage test** (`src/field-coverage.test.ts`), the direct
  port of `tokens`' own `brand-coverage.test.ts`: every `bindable: true`
  field in `VOICE_FIELDS` appears in the template, the template names no
  field this package doesn't declare (catches a stale/typo'd slot), and no
  `bindable: false` field is present (currently vacuous, kept for the day
  one exists). Verified against real, deliberately-broken fixtures in both
  directions (a slot removed, a bogus slot added) before being trusted.
- **The unbound signal** (`checkCopy`'s new `report.bound`, plus an
  `"error"`-severity, **unwaivable** `"voice:unbound-placeholder"` finding
  per unfilled slot). `tokens.css` has a visual answer to "did anyone bind
  this yet" — visible grey plus a dev-mode badge until `data-brand-bound`
  is set. Text has no pixel fallback, so the honest analog is truthful
  default DATA instead: every bindable template slot is filled with one
  loud, exported sentinel (`TEMPLATE_PLACEHOLDER`) rather than a
  plausible-looking example value, and `checkCopy` scans every string
  reachable in `record` for it, unconditionally, whether or not `copy` is
  even given. Deliberately surfaced as a real `findings` entry, not merely
  a boolean flag: this package's own README already tells every caller to
  do `if (report.findings.some(f => f.severity === "error")) process.exitCode = 1;`
  — an unbound record now fails that exact, pre-existing idiom on its own.
  Deliberately excluded from the waiver mechanism (a waiver naming
  `"voice:unbound-placeholder"` does nothing, and is itself reported as
  `"waiver:unused"`): binding is a structural precondition, not a judgment
  call a reviewer can override with a reason, the same category as the
  `TypeError`s `checkCopy` already throws for a malformed call. Proven
  against the real, shipped template (not a hand-written stand-in) in
  `src/template-binding.test.ts`.

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
