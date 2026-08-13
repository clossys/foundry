# @vespeneventures/governance

The read-only process authority for a package workspace. It defines the
package-creation, maintenance, review, release-readiness, and retirement
records that the owning repository must prove; plans reviewable private
starters or repository-profiled package files; and owns the package-process
catalog, gates, release, repository-profile, and review-evidence subpaths.

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
- `validatePackageLifecycle` is a pure schema check. It distinguishes an
  incubating source package, a published package, a qualified package, and an
  adopted package. Deprecated and retired packages need a viable replacement
  and range (or a terminal no-successor reason), dated evidence, and durable
  decision and migration references.
- `runGovernanceCheck` calls the included `./gates` subpath for real
  workspace discovery and deterministic build order, then requires the
  lifecycle registry to match that catalog exactly.
- `preflightGovernedPackage` calls the included `./release` subpath for its
  packed-install proof and adds the workspace governance result. It does not
  publish or authenticate. A private registry proof remains the caller's
  deliberate release operation.

## Package-process subpaths

Install `@vespeneventures/governance` once and import the focused capability
you need. The root remains lifecycle and scaffold planning; the subpaths keep
their established contracts separate without making consumers select five
separately versioned packages.

| Subpath | Includes |
| --- | --- |
| `@vespeneventures/governance/catalog` | Workspace discovery and dependency-graph evaluation. |
| `@vespeneventures/governance/gates` | Foundation checks, deterministic build order, secret-surface gates, and `foundry-check`. |
| `@vespeneventures/governance/release` | Isolated packed-artifact and installed-import proof. |
| `@vespeneventures/governance/repository` | Consumer-owned repository-profile contracts, validation, and `repository-check`. |
| `@vespeneventures/governance/review` | Provider-neutral review evidence contracts, validation, and `review-check`. |
| `@vespeneventures/governance/review/github` | Pure normalization of caller-provided GitHub-shaped review evidence. |

## Migrating from compatibility packages

The previous standalone names remain published compatibility packages while
consumers migrate. New integrations use the governance subpaths below. Root
imports and CLI command names remain compatible during the transition.

| Deprecated package | Supported import |
| --- | --- |
| `@vespeneventures/catalog` | `@vespeneventures/governance/catalog` |
| `@vespeneventures/gates` | `@vespeneventures/governance/gates` |
| `@vespeneventures/release` | `@vespeneventures/governance/release` |
| `@vespeneventures/repository` | `@vespeneventures/governance/repository` |
| `@vespeneventures/review` | `@vespeneventures/governance/review` |
| `@vespeneventures/review/github` | `@vespeneventures/governance/review/github` |

## Lifecycle registry

Store consumer-owned package state in JSON. The registry must name every
package the workspace catalog finds. Deprecated and retired entries are the
deliberate exception: they may remain after source removal as auditable
terminal evidence.

```json
{
  "schemaVersion": 1,
  "packages": [
    { "name": "@example/core", "status": "adopted" },
    {
      "name": "@example/legacy-core",
      "status": "deprecated",
      "replacement": { "name": "@example/core", "range": "^1.0.0" },
      "deprecatedOn": "2026-08-11",
      "decision": "https://example.invalid/decisions/core-replacement",
      "migration": "https://example.invalid/migrations/legacy-core"
    }
  ]
}
```

A new registry entry uses one of these maturity states:

| Status | Meaning |
| --- | --- |
| `incubating` | Source exists but no registry release is asserted. |
| `published` | A releasable package version is available from its intended registry. |
| `qualified` | Published and has passed the owner-defined integration or release proof. |
| `adopted` | Qualified and in confirmed consumer use. |
| `deprecated` | Still available while consumers migrate. |
| `retired` | No longer current or installable from this workspace; retained as durable migration evidence. |

`active` remains valid for schema-v1 compatibility, but carries no maturity
claim and should not be used for new records. A replacement must also be
listed with `published`, `qualified`, `adopted`, or legacy `active` status;
its range must be a semver range. Decision and migration values are durable
paths or URLs, not self-attested completion booleans. This is only an
intentional record of migration state; it does not deprecate a registry
package or remove any files.

For a terminal retirement with no successor, replace `replacement` with a
non-empty `noReplacementReason`; it remains subject to the date, decision,
and migration evidence requirements. A `deprecated` record requires
`deprecatedOn`; a `retired` record requires `retiredOn` and may retain its
earlier `deprecatedOn` as historical evidence.

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
  packages: [{ name: "@example/widgets", status: "incubating" }],
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
| `PackageLifecycleDocument` / `PackageLifecycleEntry` / `PackageLifecycleStatus` | types | Consumer-owned maturity registry, one lifecycle entry, and its status vocabulary. |
| `LifecycleFinding` / `LifecycleFindingRule` | types | Deterministic lifecycle validation result and rule vocabulary. |
| `GovernanceReport` | type | Foundation report, build order, lifecycle findings, and combined status. |
| `NewPackagePlanInput` / `NewPackagePlanProfile` / `NewPackagePlan` / `NewPackagePlanReadiness` / `PackageScaffoldFile` | types | New-package input, repository-owned profile, readiness state, and reviewable generated file plan. |
| `GovernedPreflightOptions` / `GovernedPreflightReport` | types | Options and result for the release-plus-governance preflight. |

## Requirements

Node 20+. ESM only. Runtime dependencies: `@vespeneventures/policy`, and
TypeScript — but only for the source-aware secret-surface checks reachable
through `./gates`. A plain `import "@vespeneventures/governance"` (the root
entry) never loads TypeScript: `runGovernanceCheck` and
`preflightGovernedPackage` import the specific foundation/build-order
functions they need directly, never the `./gates` barrel those secret-surface
checks also live in. Import `@vespeneventures/governance/gates` yourself if
you want the secret-surface checks — that subpath still carries the full
TypeScript dependency, unchanged.

This is a TypeScript-specific guarantee, not a general "the root does no
I/O" one. Both root functions genuinely read the real filesystem
(`node:fs`) — `runGovernanceCheck` for real workspace discovery via this
package's own `./catalog`, exactly as this file's own "Boundaries" section
above already says. `preflightGovernedPackage` goes further and also uses
`node:child_process`: packing a real tarball and running `npm install`
against it in a temp directory is the actual job `./release` does, has
always done, and cannot do any other way. Neither of those is new, and
neither is what issue #152 was ever about — only TypeScript itself (a
whole compiler, unusable in a browser/edge bundle regardless of whether
`node:fs`/`node:child_process` are even reachable there) was the surprising,
avoidable weight.

## Licence

MIT
