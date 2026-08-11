# @vespeneventures/governance

The read-only process layer for a package workspace. It plans reviewable
private starters or repository-profiled package files; requires an explicit
lifecycle entry for every real package; and composes the existing catalog,
gates, and release evidence rather than recreating any of them.

```bash
npm install @vespeneventures/governance
```

## Boundaries

`governance` does not write a scaffold, invoke a declared command, publish a
package, deploy anything, read credentials, or supply a provider setting. A
caller owns all of those actions and values.

- `planNewPackage` is creation planning only: without a profile, it returns a
  private starter and explicit remaining actions. It does not touch disk. A
  profile is owned by the consuming repository and supplies its actual
  metadata, tooling, license text, and dated changelog entry.
- `validatePackageLifecycle` is a pure schema check. A deprecated package
  needs an active replacement and range, a real deprecation date, and durable
  decision and migration references.
- `runGovernanceCheck` calls `@vespeneventures/gates` for real workspace
  discovery and deterministic build order, then requires the lifecycle
  registry to match that catalog exactly.
- `preflightGovernedPackage` calls `@vespeneventures/release` for its
  existing packed-install proof and adds the workspace governance result. It
  does not publish or authenticate. A private registry proof remains the
  caller's deliberate release operation.

## Lifecycle registry

Store consumer-owned package state in JSON. The registry must name every
package the workspace catalog finds, and nothing it does not find.

```json
{
  "schemaVersion": 1,
  "packages": [
    { "name": "@example/core", "status": "active" },
    {
      "name": "@example/legacy-core",
      "status": "deprecated",
      "replacement": { "name": "@example/core", "range": "^1.0.0" },
      "deprecatedOn": "2026-08-11",
      "decision": "docs/decisions/core-replacement.md",
      "migration": "docs/migrations/legacy-core.md"
    }
  ]
}
```

A replacement must also be listed and have `"status": "active"`; its range
must be a semver range. Decision and migration values are durable paths or
URLs, not self-attested completion booleans. This is only an intentional
record of migration state; it does not deprecate a registry package or remove
any files.

For a terminal retirement with no successor, replace `replacement` with a
non-empty `noReplacementReason`; it remains subject to the date, decision,
and migration evidence requirements.

## Usage

```ts
import {
  planNewPackage,
  runGovernanceCheck,
  type PackageLifecycleDocument,
} from "@vespeneventures/governance";

const plan = planNewPackage({
  name: "@example/widgets",
  description: "Widget contracts.",
});
// plan.readiness === "starter". Review plan.requiredActions and plan.files,
// then write them in the caller's own change process.

const lifecycle: PackageLifecycleDocument = {
  schemaVersion: 1,
  packages: [{ name: "@example/widgets", status: "active" }],
};
const report = runGovernanceCheck(process.cwd(), lifecycle, { scope: "@example" });
if (!report.ok) process.exitCode = 1;
```

### Profiled package plans

The default plan intentionally cannot be published: it is private and omits
repository-specific build, test, registry, ownership, license, and changelog
details. Do not treat it as a package template for another workspace.

To request a complete file plan, the caller supplies every convention that
governance cannot safely invent. `profile.manifest` must include `private`,
`author`, `license`, `repository`, `bugs`, `homepage`, `engines`, `scripts`,
and non-empty `devDependencies`; public packages also need
`publishConfig.registry`. The profile must supply actual source, test,
TypeScript, README, license, and dated-changelog contents. Governance still
only returns the proposed files; it never writes them.

For a proposed release, add the isolated tarball proof already owned by
`release`:

```ts
import { preflightGovernedPackage } from "@vespeneventures/governance";

const report = await preflightGovernedPackage(process.cwd(), "packages/widgets", lifecycle, {
  scope: "@example",
});
if (!report.ok) process.exitCode = 1;
```

## CLI

`foundry-governance` reads one lifecycle JSON file and prints a deterministic,
compact text report by default. It never runs package scripts or writes
workspace state.

```bash
foundry-governance package-lifecycle.json . --scope @example
foundry-governance package-lifecycle.json . --scope @example --format json
foundry-governance package-lifecycle.json . --scope @example --verbose
```

It exits `0` for a complete clean report, `1` for a governance finding, and
`2` when it cannot read or parse its arguments, lifecycle file, or workspace
root. `--format json` prints the compact machine-readable summary; add
`--verbose` to either format for the complete report. Use
`foundry-governance --help` for the full invocation contract.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `PACKAGE_LIFECYCLE_VERSION` | constant | Supported lifecycle schema version, currently `1`. |
| `planNewPackage(input)` | function | Returns a deterministic, no-write private starter or repository-profiled package plan. |
| `validatePackageLifecycle(value)` | function | Purely validates a lifecycle document without workspace I/O. |
| `evaluateLifecycleCoverage(value, packageNames)` | function | Validates a lifecycle document and checks it names exactly the supplied packages. |
| `runGovernanceCheck(root, lifecycle, options?)` | function | Composes the existing foundation check and build order with lifecycle coverage. |
| `preflightGovernedPackage(root, packageDir, lifecycle, options?)` | function | Combines `release`'s existing package preflight with a governance report. |
| `PackageLifecycleDocument` / `PackageLifecycleEntry` | types | Consumer-owned lifecycle registry and one active or deprecated entry. |
| `LifecycleFinding` / `LifecycleFindingRule` | types | Deterministic lifecycle validation result and rule vocabulary. |
| `GovernanceReport` | type | Foundation report, build order, lifecycle findings, and combined status. |
| `NewPackagePlanInput` / `NewPackagePlanProfile` / `NewPackagePlan` / `NewPackagePlanReadiness` / `PackageScaffoldFile` | types | New-package input, repository-owned profile, readiness state, and reviewable generated file plan. |
| `GovernedPreflightOptions` / `GovernedPreflightReport` | types | Options and result for the release-plus-governance preflight. |

## Requirements

Node 20+. ESM only. Runtime dependencies: `@vespeneventures/gates` and
`@vespeneventures/release`.

## Licence

MIT
