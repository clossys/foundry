# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

## [0.4.1] - 2026-09-22

### Added

- `foundry.capabilities` (schema v3, issue #1196): a MECE capability map of
  this role's craft — 11 capabilities `built` against
  `strategist-check`'s existing facts/brand-coverage/direction/handoff
  subcommands and `projector.ts` (evidence base, audience understanding,
  market definition, positioning, claims, brand derivation, mission and
  values, the roadmap, direction currency, constraints, and the strategy
  brief for #1204's Foundation layer); business model and pricing
  hypothesis, the north-star metric tree (#533, #1272), and the
  competitive landscape (#1268) are declared `planned`. Every `built`/
  `partial` capability's `proofCase` resolves against this role's own
  retained qualification adapter — today that adapter has one retained
  case (`facts-clean`), cited across every built capability pending
  dedicated per-capability cases (#1272). Drafted per #1198, checked
  MECE across the five v0 Launch-pack roles by `check-capability-maps.mjs`
  (report mode: 0 findings; `--enforce`, with the other 14 roles
  allowlisted: 0 findings — output in PR #1258). Independent review
  applied: #1258.

## [0.4.0] - 2026-09-22

### Changed

- **Breaking default:** the consumer-facing strategy directory moves from a
  root `strategy/` directory to `clossys/strategist/` — the subfolder
  `@clossys-strategist` owns inside the single visible `clossys/` folder,
  one subfolder per role, per #1171's owner decision (approved
  2026-09-22). Every documented default and example (the CLI's own usage
  text, error-message examples, the skill's "Strategy directory" section,
  and this README) now names `clossys/strategist/`. `readStrategy` and the
  `strategy-dir` argument themselves are unchanged — they still take an
  explicit root and do no directory-resolution of their own; only
  `strategist-check`'s own default, used when `strategy-dir` is omitted,
  changed. Refs: #1171, #1187.
- `strategist-check`, `strategist-check handoff`, and `strategist-check
  apply` no longer require `strategy-dir`: omitted, each now resolves it
  via the fallback below. An explicit `strategy-dir` argument is unaffected
  and always wins outright. Refs: #1171, #1187.

### Added

- **Legacy fallback, for exactly one release:** when `strategy-dir` is
  omitted and `clossys/strategist/` does not exist but the retired
  `strategy/` does, `strategist-check` reads `strategy/` instead and prints
  a plain-language notice to move it. When both exist at once, the result
  is `indeterminate` (exit `2`) with a notice — never a silent pick between
  two possibly-conflicting registries. The new pure resolver
  `resolveDefaultStrategyDirectory` (`strategy-dir-default.ts`) is
  exported for consumers that want the same three-way resolution in their
  own tooling. Refs: #1171, #1187.

### Removal planned

- **The `strategy/` fallback above is scheduled for removal in the next
  release (0.5.0).** After 0.5.0, an absent `clossys/strategist/` is
  reported as an ordinary missing-directory error; `strategy/` is no
  longer consulted. Move `strategy/` to `clossys/strategist/` before then.
  Refs: #1171, #1187.

### Migration

- Move a root `strategy/` directory to `clossys/strategist/`. Nothing else
  about the directory's contents changes.
- An explicit `strategy-dir` CLI argument, or an explicit root passed to
  `readStrategy`, needs no change — update it whenever convenient.
- Drop any `strategist-check ./strategy ...` invocation's directory
  argument once the move is done, or update it to
  `./clossys/strategist`; either continues to work.

## [0.3.0] - 2026-09-21

### Changed

- **Breaking:** one authored `strategy/` directory replaces the retired split
  brand files and positioning madlib fields. `readStrategy` loads
  `facts.json`, `audiences.json`, `markets.json`, `positioning.json`,
  `claims.json`, `constraints.json`, `brand.json`, `mission.json`,
  `roadmap.json`, and `direction.json`. `StrategyBundle.complete` means every
  present file validates; handoff readiness is a separate, opt-in check.
  Refs: #1115, #1116.
- `DirectionEntity` drops `statement` and `kind`; each record names a
  `subject` `{ file, id }` pointing at another directory record. Facts are
  not direction subjects, and `DirectionSubject.file` is a closed vocabulary
  of the remaining strategy record files — handoff resolves `brand.json`
  (attribute id), `constraints.json`, and `roadmap.json` subjects alongside
  it. Refs: #1116.
- Retired `forWhom` / `reasonToBelieve` and `brand-essence.json` /
  `brand-attributes.json` / `brand-derivations.json` fail validation with
  findings that name `audienceIds`, `claimIds`, or `brand.json`. Refs: #1116.

### Added

- Facts gate: catalogue-count claims spelled as `twenty` or `twenty-one`, or
  as a digit run, followed by `packages` or `records`, are scanned like
  other numeric claims. Wired against this repository's own facts subject
  and publishing document through a repository-level subject check; none
  of those three files ship in this package, so they are described rather
  than cited by path. Refs: #500.
- `strategist-check handoff <strategy-dir>`: an opt-in gate, separate from
  `StrategyBundle.complete`, that exits 0 only when facts, audiences,
  positioning, at least one approved claim, a `constraints.json` file, and
  resolvable brand and direction refs are present and valid. An empty
  `constraints.json` is valid; markets, mission, and roadmap stay optional.
  A facts-only directory — including this repository's own — still passes
  `readStrategy` and fails handoff; the catalogue-count subject above never
  calls it. Refs: #1117.
- `projectStrategyContract` / `projectAndValidateStrategyContract`: project
  a portable `StrategyContract` from the strategy bundle, with provenance
  source `strategy-directory` and evidence synthesized from each claim's
  `basis` plus its optional fact refs, so the contract is no longer a second
  authored original. `validateStrategyContract` and
  `createStrategyProvenance` remain exported for adapters and Publisher
  seals. The skill and README list each directory file, which fields are
  bound, which are room, and the refused uses. Refs: #1118.
- `strategist-check apply`: requires public prose `claim:<id>` markers to
  resolve to an approved claim (a hypothesis id fails, a missing id fails),
  and requires a designer-facing surface a `constraints.json` entry targets
  to cite that constraint's id. The facts gate is unchanged. Refs: #1119.

### Migration

- Merge brand essence, attributes, and derivations into `brand.json`
  (`essence.statement`, attributes with `id`/`statement`/`basis`,
  derivations with `attributeId`/`tokenSlots`/`voiceRuleIds`).
- Replace positioning `forWhom` and `reasonToBelieve` with `audienceIds` and
  `claimIds`.
- Replace audience `description`/`painPoints` with `situation` and `pains`.
- Replace mission value `name` with kebab-case `id`.
- Author `claims.json`, `constraints.json`, and `direction.json` for
  handoff; run `strategist-check handoff` before downstream skills cite ids.

## [0.2.7] - 2026-09-21

### Changed

- Packed skill: expression-wave ownership — maintain evidence-backed strategy
  records and brand derivation; do not own the consumer brand overlay bytes,
  author the in-tree page document (Designer and Writer together), invent
  product copy, or publish surfaces. Refs: #1027.

## [0.2.6] - 2026-09-21

### Added

- Ships the `clossys-strategist` Agent Skill (`skill/SKILL.md`) next to the
  existing gate bins `strategist-check` and `strategist-rate-check`. In
  Cursor, mention `@clossys-strategist` to invoke that voice. The skill is
  packed with the package; it does not add runtime exports and does not
  replace the gate CLIs. The packed skill states that mechanical gates prove
  3 only, never treats gate-green as keep, and names a walk that stops at 3
  as a defect; the Designer pre-auth quality brief (shipped with `@clossys/designer`, not in this package) remains canonical for
  exceptional (5) and does not ship with this package. The skill names
  `strategist-check brand-coverage` slot N/N as necessary, not sufficient,
  and points at `--surfaces` for Designer-readable do-not language (#1034).
- `strategist-check brand-coverage --surfaces`: reports Designer-readable brand
  law separately from slot N/N coverage (#1034).

## [0.2.5] - 2026-09-21

### Added

- `strategist-check --exclude <glob>` (repeatable): omits repo-relative
  path globs such as `**/*.test.ts` or `**/fixtures/**` from the facts
  gate walk; directory-name skips remain `--skip-dirs`.
- README **Audience-facing copy only** recipe: shared extensions,
  `--skip-dirs`, and `--exclude` contract for advisory vs blocking scans
  (#1019).
- `FactsGateOptions.scanStyleLiterals`: opt in to treating CSS/inline-style
  percentage literals as claims; default skips `color-mix()`, declaration-
  shaped `prop: N%`, and `style={{…}}` / `style="…"` regions (#1019).
- `check-package-skills` regression: strategist skill must keep the
  brand-coverage necessary-not-sufficient and `--surfaces` do-not language
  (#1034).

## [0.2.4] - 2026-09-21

### Changed

- `strategist-check --facts-dir` walks nested subdirectories for `*.json`
  `Fact[]` leaves (paths such as `company/customers.json`), skips
  `_schema.json` meta leaves, and refuses group-object domain JSON with an
  explicit message rather than a generic array-shape error.
- `Fact.value` money objects accept authored `{ value, currency }` and
  normalize to `{ amount, currency }` on read.

### Notes

- Nested group-object facts trees remain consumer-local: the engine ingests
  only flat `facts.json` or `--facts-dir` leaves that are each a `Fact[]`.
  Refs: #1020.

## [0.2.2] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.2.1] - 2026-09-21

### Added

- `strategist-check brand-coverage --surfaces <path>`: requires do-not
  language on Designer-facing surfaces; slot N/N alone is reported as
  necessary, not sufficient.
- `strategist-check --extensions <ext>` (repeatable): limits the facts gate
  scan to the given file extensions (include the leading dot). When none are
  given, the previous default set applies.
- `strategist-check --skip-dirs <name>` (repeatable): adds directory names
  to the built-in skip list during the walk; it does not replace the
  defaults (`node_modules`, `.git`, `dist`, `build`, `coverage`).
- Skill: Audience records name who the synthetic user is;
  Strategist does not inhabit that person.

### Fixed

- `facts-gate:ignore` applies only on the line where the marker appears; a
  marker on one line never suppresses claims on following lines.
- `facts-gate:ignore` markers no longer match the prefix
  `facts-gate:ignoreme` — the ignore token must end at a word boundary.

## [0.2.0] - 2026-09-19

### Added

- `readStrategyDirectory`, a pure reader that combines a directory of
  per-fact JSON leaves into one validated `Fact[]`. It accepts the
  directory's contents as a map of relative path -> raw file text (no
  filesystem access of its own — `readStrategy` remains this package's
  one deliberate I/O surface, and a CLI or programmatic caller feeds the
  map), validates every leaf with the same `validateFacts` rules the flat
  file follows, and refuses — naming the offending file — any leaf that
  is unparseable, schema-invalid, or not a `*.json` file at all, plus a
  directory holding no JSON leaf. Facts from leaves that did validate are
  still returned; judgement about an incomplete set belongs to the
  caller, the same discipline `readStrategy`'s `issues`/`complete` pair
  holds to.
- Each fact read from a directory records its provenance in the new
  optional `Fact.sourceFile` (the leaf's path as supplied). `readStrategy`
  leaves the field unset; validators neither require nor reject it.
- `strategist-check --facts-dir <dir>`: reads facts from a directory of
  per-fact JSON files instead of the flat `facts.json`, via the same
  fail-closed contract — any leaf refusal is exit code 2, never a clean
  pass. `--facts-dir` and the flat `facts.json` are mutually exclusive:
  supplying both is refused (exit 2), naming the conflict.

### Notes

- This does not claim the position is closed. No publication or
  qualification is recorded by this change.

## [0.1.6] - 2026-09-18

### Added

- Documented installation against the public npm registry
  (`https://registry.npmjs.org`) and that installing needs no authentication.
- Stated the charter close condition in the README: independent consumer
  evidence of `strategy traceability rate`, computed by
  `assessStrategyTraceabilityRate()`. An empty evaluated set is
  indeterminate, never a perfect rate of 1. `checkFactsTraceability`
  remains the facts gate; it is not this combined rate.
- Declared `foundry.assessment` against a new mapped `strategist-rate-check`
  bin with `invocation: "single-json-input"`. `strategist-check` remains the
  multi-mode CLI and is not the assessment surface. Advisor remains the
  only required first-day role.
- `strategist-rate-check assessment.json`: prints the `strategy
  traceability rate` report and exits on the `0` / `1` / `2` ternary.

### Notes

- This does not claim the position is closed. Qualification of `0.1.6` is
  deferred under #833.

## [0.1.5] - 2026-09-14

### Changed

- Patch version bump only, to obtain a fresh, never-before-used
  `governance/release-qualifications/` record path. The 0.1.4 qualification
  record added by #811 was orphaned when that pull request was squash-merged
  (#821) and had to be removed (#834); the immutability gate that protects
  already-introduced record paths (`check-candidate-qualification.mjs`'s
  single-introduction-commit invariant) means a valid record can never again
  be introduced at the `0.1.4` path, so this package moves to `0.1.5`
  purely to regain one. No functional or behavioral change.


## [0.1.4] - 2026-09-09

### Changed

- Historical entries below now describe the previous npm scope without naming
  the producer account this catalogue no longer publishes under, and links to
  this repository use its current `clossys/foundry` path. No date, version,
  or recorded fact changed — only the way the retired scope is referred to.


## [0.1.3] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `strategist-check` would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.1.2] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.1] - 2026-08-24

### Fixed

- Updated README references to active Designer, Writer, and Controller
  subpaths after the predecessor packages retired.

## [0.1.0] - 2026-08-20

First release. This package is the strategist role, recut from
the previous scope's `strategy` package per
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
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`, following the convention the operation packages adopted in
  #417. A consumer reading the installed package should not have to leave it to
  find out what changed; a new package should be born with the current
  convention rather than inheriting its donor's gap.

### Changed from the previous scope's `strategy`

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

> **Current lifecycle note:** the previous scope's `strategy` is now retired.
> This release note records its state at 0.1.0; the lifecycle contract is the
> authority for current availability.

- **No forwarding stub in the donor.** The previous scope's `strategy` is
  deprecated-and-retained: still installable for a consumer already pinned to
  it, with no re-export pointing here. A stub would keep the old name
  importable, and a supersession check could then never reach zero — the
  forwarding layer would defeat the gate built to prove the swap completed.
