# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - Unreleased

### Added

- The brand layer, absorbed here after a standalone `brand` package was
  planned and cancelled: stripped of what `strategy` already owned
  (`Mission.values: OperatingValue[]` is already brand values — see that
  entity's own doc comment), a separate package would have shipped as a
  thin record with no reader, the same shape as this repository's retired
  `icons` package.
  - `validateBrandEssence`: `{ statement }` — the irreducible one-line
    statement of what the brand is. Hand-rolled, same validation style as
    every other entity in `schema.ts`.
  - `validateBrandAttribute`/`validateBrandAttributes`: `{ name,
    description, evidence: { basis, factRef? } }`. `evidence.basis` is
    required prose — what actually makes the attribute true, not a vibe.
    `evidence.factRef` is an optional, opaque string naming a `Fact.key`,
    the same seam `@vespeneventures/voice`'s `Claim.factRef` and this
    package's own `Market.factRefs`/`Audience.factRefs` already use.
  - `validateBrandDerivation`/`validateBrandDerivations`
    (`brand-derivation.ts`): `{ attribute, tokenSlots: string[],
    voiceRules: string[], rationale }` — what a `BrandAttribute` implies
    for named visual token slots and named voice rules. `tokenSlots` and
    `voiceRules` are plain strings, never a typed import of
    `@vespeneventures/tokens` or `@vespeneventures/voice` — this package
    keeps its **zero runtime dependencies**. Rejects a derivation naming
    neither a slot nor a rule.
  - `checkBrandCoverage(brandableSlots, derivations)`: pure, two-directional
    coverage checker — every brandable slot has a derivation behind it,
    and no derivation names a slot that doesn't exist — mirroring
    `@vespeneventures/tokens`' own `brand-coverage.test.ts`. Because this
    package cannot import `tokens`, `brandableSlots` is caller-supplied;
    see the README's "The brand layer" for the seam. **Fails closed** on
    either an empty `brandableSlots` or an empty `derivations`
    (`ok: false`, with an explicit `reason`) — never a silent, vacuous
    pass when there was nothing to check.

## [0.1.0] - Unreleased

### Added

- Initial release. Hand-rolled, dependency-free entity validators —
  `validateFact`/`validateFacts`, `validateMoney`,
  `validateMission`/`validateMission`'s `OperatingValue` items,
  `validatePositioning`, `validateMarket`/`validateMarkets`,
  `validateAudience`/`validateAudiences`,
  `validateRoadmapItem`/`validateRoadmapItems`/`ROADMAP_STATUSES` —
  machinery only, no real strategy content ships in this package. Built on
  a small shared primitive layer (`validation.ts`) rather than a schema
  library, following `@vespeneventures/policy`'s own `validate.ts`
  precedent (plain type guards over `unknown`, an accumulated issue list,
  never throws) — this package ships **zero runtime dependencies**, the
  same as `@vespeneventures/catalog`, `@vespeneventures/policy`, and
  `@vespeneventures/tokens`.
- `readStrategy(root)`: a typed reader that loads and validates a
  consumer's own `strategy/` directory. Never throws; records anything it
  could not turn into usable data into `StrategyBundle.issues`, the same
  gather-don't-judge discipline `@vespeneventures/catalog`'s `buildCatalog`
  uses for `Catalog.skipped`.
- `buildFactIndex`/`isTracedSurfaceForm`: a pure lookup structure over a
  `Fact[]`, matching prose against each fact's own stringified value plus
  its declared `aliases` — never a guessed/derived formatting.
- `checkFactsTraceability`: the facts-traceability gate. Scans prose and
  copy for currency amounts, percentages, multipliers, large/labelled
  counts, and a closed set of absolute/superlative phrases, and fails when
  one cannot be traced to a `facts.json` entry — directly, or via a
  `fact:<key>` citation. Ships an explicit, auditable escape hatch
  (`facts-gate:ignore`, recorded into `result.ignored`, never silent) and a
  structural check against the escape hatch's own failure mode (a citation
  to a fact key that doesn't exist is itself a finding). Pure — no I/O,
  never throws.
- `scanStrategyDirectory`: the I/O half of the gate. Walks a real directory
  for `.md`/`.mdx`/`.ts`/`.tsx`/`.js`/`.jsx` files. **Fails closed**: throws
  rather than silently treating an unreadable directory as empty, matching
  this repository's `scripts/check-contamination-classes.mjs` walker.
- `strategy-facts-check` CLI (`bin`), wired to the same three-state exit
  code contract `@vespeneventures/gates`' `foundry-check` uses: `0` clean,
  `1` findings, `2` could not run — explicitly covering "facts.json is
  missing or invalid" and "the scan matched zero files" as `2`, never a
  silent `0`. This is the explicit third state a pass/fail-only gate is
  missing, and the specific failure mode this package's gate is built
  against.
