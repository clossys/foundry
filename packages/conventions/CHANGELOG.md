# Changelog

All notable changes to `@vespeneventures/conventions` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-14

### Added

- Capability-first skill registry schema version 2, including pure validation
  for repository-qualified skill identity, `plane` and `repository` scope,
  capability coverage unions, durable accepted gaps, and explicit third-party
  inventory entries that cannot silently satisfy first-party coverage.
- `validateRoutineSkillCoverage`, which checks only that a routine's
  repository-qualified target exists and its scope is a subset of the skill's
  declared coverage. Cadence and live scheduler state remain separate.
- The proven `expand` and `groom` skill verbs.
- A shipped `skill-registry` convention document with account-neutral migration
  patterns for tree-discovered and centrally inventoried consumers.

## [0.2.0] - 2026-08-14

### Added

- Restored the `./documents/*` and `./adapters/*` export subpaths, removed in
  `0.1.1`. `@vespeneventures/governance@0.4.1` (foundry#193) taught the
  publish-verification round trip to expand a wildcard export subpath against
  what actually shipped instead of resolving it as a literal path, which is
  what made `0.1.1` necessary in the first place.

  `documentPath(id)` and `adapterPath(id)` are unaffected and remain the
  primary way to reach a shipped file; the subpaths are a second route for a
  consumer whose own tooling wants an import specifier rather than a resolved
  path.

## [0.1.1] - 2026-08-14

### Removed

- The `./documents/*` and `./adapters/*` wildcard export subpaths.

  They were never the documented way to reach a shipped file — `documentPath`
  and `adapterPath` return real filesystem paths and do not go through Node's
  `exports` resolution at all — and their presence broke this package's
  post-publish round-trip verification, which resolves an export target as a
  literal path and so looked for a file named `*`.

  Nothing about which files ship has changed: `documents/` and `adapters/` are
  still in `files`, and both path helpers work exactly as before. Only access
  by import specifier is gone, and only for the two wildcard subpaths.

## [0.1.0] - 2026-08-13

### Added

- Six default documents: branch provenance, skill grammar, agent
  interoperability, routine declarations, machine-wide agent guidance, and the
  machine baseline.
- Three adapter defaults: execution-policy rules, shell integration, and a
  branch-provenance hook configured entirely through the environment.
- `renderProductLoader` for a product's instruction-file loader. Generated
  against a caller-supplied path rather than shipped as a file, because the
  import target depends on where the guidance was installed.
- `validateBranchName` and `TAXONOMY_PREFIXES` for branch provenance. The
  validator reports rather than passing vacuously when a caller declares no
  agent prefixes.
- `validateSkillName`, `validateSkillSet`, and `SKILL_VERBS` for skill naming
  and ownership.
- `validateRoutineDeclaration`, `validateRoutineSet`,
  `validateScheduledSkillDescription`, and `reconciliationFindingKinds` for
  routine declarations.
- `scanNeutrality` for the publishing precondition: absolute paths,
  operator-specific home directories, and caller-supplied plane-owned names.
- `documentPath`, `adapterPath`, `templatedFilenames`, `CONVENTION_DOCUMENTS`,
  `CONVENTION_ADAPTERS`, `DOCUMENTS_ROOT`, and `ADAPTERS_ROOT` for reaching the
  shipped defaults without this package performing any I/O.

[0.3.0]: https://github.com/vespeneventures/foundry/releases/tag/conventions-v0.3.0
[0.2.0]: https://github.com/vespeneventures/foundry/releases/tag/conventions-v0.2.0
[0.1.1]: https://github.com/vespeneventures/foundry/releases/tag/conventions-v0.1.1
[0.1.0]: https://github.com/vespeneventures/foundry/releases/tag/conventions-v0.1.0
