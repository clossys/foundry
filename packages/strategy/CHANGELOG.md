# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.3] - 2026-08-19

### Changed

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/vespeneventures/foundry/issues/273). No runtime behavior changed.

## [0.2.2] - 2026-08-13

### Changed

- README now states up front that this package spans both strategy records
  and the brand layer (`BrandEssence`, `BrandAttribute`, `BrandDerivation`,
  `checkBrandCoverage`), and why the two are one package: the name-only
  seam that keeps this package at zero runtime dependencies. Someone
  scoping an adoption from the package name alone could previously miss the
  brand half and leave it stranded. Documentation only — no API change.

## [0.2.1] - 2026-08-13

### Fixed

- Removed the stale "Release status" caveat claiming this package "has not
  completed a public registry release." This package is already marked
  published in this repository's own lifecycle catalog — the caveat, not
  the package, was outdated. Surfaced by a consumer integration (#147).

## [0.2.0] - 2026-08-12

### Added

- `StrategyContract`: stable, product-neutral records for products, brands,
  audiences, positioning, claims, evidence, and constraints. Every record
  carries a stable id, semantic-version revision, and source provenance.
  `validateStrategyContract` validates duplicate/conflicting records and
  cross-record links; `serializeStrategyContract` and
  `createStrategyProvenance` provide deterministic output provenance.
  Approved claims require evidence and explicit approval, while hypotheses
  remain a separate non-approved type. This is additive to the existing
  file-oriented schema/reader API: local authoring validation and the stable,
  directory-independent handoff have distinct roles.

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
  - `readStrategy` now loads brand from disk alongside every other entity:
    `brand-essence.json` (a `BrandEssence`), `brand-attributes.json` (a
    `BrandAttribute[]`), `brand-derivations.json` (a `BrandDerivation[]`),
    exposed as `StrategyBundle.brandEssence`/`brandAttributes`/
    `brandDerivations`. All three are optional in exactly the sense
    `mission.json`/`positioning.json` already are — absent is not an
    issue, present-but-invalid is, and `StrategyBundle.complete` accounts
    for all three identically to every other file this reader loads.

## [0.1.0] - 2026-08-07

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
