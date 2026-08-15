# Changelog

All notable changes to `@vespeneventures/conventions` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-08-15

### Added

- A `schedule-declaration` document and validator for the second scheduling
  tier. `routine-declaration` already asserted that model-free work is a
  distinct tier, but only the routine half had a grammar, so schedules had
  nowhere to be declared and were carried inside whichever repository happened
  to host them first.
- `validateScheduleDeclaration`, `validateScheduleSet`, `isCronExpression`, and
  `scheduleReconciliationFindingKinds`, with the `ScheduleDeclaration` and
  `ScheduleRegistry` types.
- Execution host is a first-class declared field in this tier, drawn from a
  closed list the consuming plane supplies. Hosts are deliberately not
  enumerated here: naming vendors in a grammar dates it, and adopting a new
  host should not require this package to be republished.
- Trigger correspondence checking. Where an artifact dispatches by matching a
  fired cadence against its own table, the declaration and the host's trigger
  list are two copies of one fact; a mismatch raises nothing at run time, so
  the check compares them instead. `validateScheduleSet` adds the half a single
  declaration cannot see: a host trigger that no schedule claims, which fires
  into nothing while the host still reports a successful invocation.

## [0.5.0] - 2026-08-14

### Changed

- Machine guidance now treats the configured workspace root as a repository
  discovery location, not a singular governance authority. It discovers
  applicable account-owned workspace planes from caller-owned policy, composes
  all applicable declarations without discovery-order precedence, and leaves
  repository inventory, exact roots, topology, privacy, retention, and
  decisions with each owning plane.
- Machine baseline guidance now applies privacy, recovery, diagnostic, and
  reconciliation rules across the applicable owning planes instead of assuming
  one private workspace control plane.

## [0.4.0] - 2026-08-14

### Added

- Runtime shape guards for decoded registry and routine-query JSON. Malformed
  documents and nested entries return deterministic findings rather than
  exceptions, and parse findings remain visible when target resolution also
  fails.
- Repository-qualified routine declarations and exclusions using the same
  composite skill identity as the registry, while unqualified targets retain
  closed plane-root resolution.

### Changed

- Accepted-gap references now follow an enforceable grammar: a parsed HTTPS
  issue URL or canonical repository-relative Markdown decision/ADR path.
  Invalid evidence cannot suppress a missing-coverage finding.
- Plane-scoped skills reject repository qualifiers, preventing a qualifier from
  bypassing ordinary plane-root resolution.

## [0.3.0] - 2026-08-14

### Added

- A capability-first skill registry (schema version `2.0.0`):
  `SKILL_REGISTRY_SCHEMA_VERSION`, `validateSkillRegistry`,
  `computeCapabilityCoverage`, and `validateRoutineCoverage`, plus the
  `SkillRegistry`, `Capability`, `RegisteredSkill`, `SkillScope`,
  `SkillCapabilityImplementation`, `AcceptedGap`, `RoutineCoverageQuery`, and
  `CapabilityCoverage` types. The registry declares functional coverage
  independently of any routine: a skill's identity is the pair
  `(repository, name)`, a capability declares the target set it requires, a
  skill declares which capability and targets it implements, and coverage is
  deterministic set arithmetic over that. A repository-scoped skill claiming
  coverage outside its own repository is a scope-escape finding. An accepted
  gap needs both a durable reason and an issue/ADR reference — a gap missing
  either is its own finding, and the underlying coverage gap is still
  reported rather than being silently excused. A skill marked third-party can
  declare `implements` but is deliberately excluded from first-party
  coverage. `validateRoutineCoverage` is intentionally narrow: it confirms
  only that a routine's target skill resolves and that the routine's scope is
  a subset of what that skill already declares — a routine supplies tempo,
  never coverage, so disabling or omitting one can never remove functional
  coverage the registry already recorded. Ships no filesystem, GitHub,
  scheduler, credential, or network access; it is schema plus pure functions
  over caller-supplied data, the same boundary every other validator in this
  package holds.
- A seventh shipped document, `skill-registry` (`documents/skill-registry.md`),
  describing the contract above in prose.
- `expand` and `groom` added to the closed skill-naming verb vocabulary
  (`SKILL_VERBS`), reflecting two verbs already proven in real use.

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

[0.5.0]: https://github.com/vespeneventures/foundry/releases/tag/conventions-v0.5.0
[0.4.0]: https://github.com/vespeneventures/foundry/releases/tag/conventions-v0.4.0
[0.3.0]: https://github.com/vespeneventures/foundry/releases/tag/conventions-v0.3.0
[0.2.0]: https://github.com/vespeneventures/foundry/releases/tag/conventions-v0.2.0
[0.1.1]: https://github.com/vespeneventures/foundry/releases/tag/conventions-v0.1.1
[0.1.0]: https://github.com/vespeneventures/foundry/releases/tag/conventions-v0.1.0
