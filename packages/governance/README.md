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

### `./repository` schema: `RepositoryProfile`

`@vespeneventures/governance/repository` defines and validates a
consumer-owned repository profile. It ships no profile instance of its own —
a caller supplies real values and `validateRepositoryProfile` returns every
independently checkable structural finding without I/O or throwing.

```ts
import {
  validateRepositoryProfile,
  type RepositoryProfile,
} from "@vespeneventures/governance/repository";
```

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `1` | Must equal `REPOSITORY_PROFILE_VERSION`. |
| `defaultBranch` | `string` | A valid Git branch name (rejects `HEAD`, a leading `-`, `..`, `@{`, a `.lock` suffix, control characters, and the other Git-reserved forms). |
| `commands` | `RepositoryCommand[]` | Ordered, dense array (at most 10,000 entries); command names must be unique. |
| `protectedPaths` | `string[]` | Ordered, dense array (at most 10,000 entries) of repository-relative paths; duplicates are rejected. |

`RepositoryCommand`:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Lowercase words separated by `-` or `:` (e.g. `check`, `release:tag`). |
| `run` | `string` | The command line exactly as the consumer declares it; must be non-empty. |
| `cwd` | `string?` | Optional repository-relative working directory; no glob syntax, no parent (`..`) traversal. |

`protectedPaths` entries are repository-relative and support literal path
segments plus `*` and `**` wildcards; brace expansion, character classes,
extglobs, negation, absolute paths, and parent traversal are all rejected.

```json
{
  "schemaVersion": 1,
  "defaultBranch": "main",
  "commands": [
    { "name": "setup", "run": "npm ci" },
    { "name": "check", "run": "npm run check" },
    { "name": "release:tag", "run": "npm run release -- --tag", "cwd": "packages/widgets" }
  ],
  "protectedPaths": [".github/workflows/**", "packages/core/src/**"]
}
```

Types found in `packages/governance/src/repository/types.ts`; validation
rules found in `packages/governance/src/repository/validate.ts`.

### `./review` schema: `ReviewPolicy` and `ReviewEvidenceBundle`

`@vespeneventures/governance/review` defines a provider-neutral snapshot of
evidence gathered while reviewing one proposed change, and the consumer-owned
policy it must satisfy. `validateReviewEvidence` fails closed: incomplete
pagination, a stale (different-head) item, an unresolved thread, or an
unsatisfied policy requirement all produce findings rather than a silent
pass.

```ts
import {
  validateReviewEvidence,
  type ReviewEvidenceBundle,
  type ReviewPolicy,
} from "@vespeneventures/governance/review";
```

`ReviewPolicy` — the consumer-owned requirement set:

| Field | Type | Notes |
| --- | --- | --- |
| `requiredChecks` | `string[]` | Names of checks that must report `"success"` for the current head; no duplicates. |
| `requireApproval` | `boolean` | Whether one current-head approval is required. |

`ReviewEvidenceBundle` — the provider-neutral snapshot for one head:

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `1` | Must equal `REVIEW_EVIDENCE_VERSION`. |
| `headSha` | `string` | Exactly 40 lowercase hexadecimal characters — the exact commit this snapshot was observed against. |
| `paginationComplete` | `boolean` | Must be `true`. `false` means at least one paginated collection below was not fully consumed and the bundle must not be treated as approval-ready. |
| `checks` | `ReviewCheck[]` | Dense array, at most 10,000 entries. |
| `reviews` | `ReviewRecord[]` | Dense array, at most 10,000 entries. |
| `threads` | `ReviewThread[]` | Dense array, at most 10,000 entries. |

`ReviewCheck`: `name` (`string`), `conclusion` (one of `"success"`,
`"failure"`, `"neutral"`, `"skipped"`, `"cancelled"`, `"timed-out"`,
`"action-required"`, `"pending"`, `"unknown"`), and `headSha` (must match the
bundle's `headSha`, or the check is reported as stale evidence and ignored).

`ReviewRecord`: `id` (`string`), `reviewerId` (`string`, opaque and
provider-neutral), `submittedAt` (RFC 3339 timestamp with `Z` or an explicit
offset, up to millisecond precision), `state` (one of `"approved"`,
`"changes-requested"`, `"commented"`, `"dismissed"`, `"pending"`,
`"unknown"`), and `headSha` (must match the bundle's `headSha`). Only each
reviewer's latest current-head decisive state (`approved`,
`changes-requested`, or `dismissed`) is effective; `commented`/`pending`/
`unknown` never replace a decisive state, and two decisive states sharing a
timestamp for the same reviewer are reported as ambiguous rather than
resolved by array order.

`ReviewThread`: `id` (`string`), `isResolved` (`boolean` — `false` on a
current-head thread is reported as an unresolved-thread finding), and
`headSha` (must match the bundle's `headSha`).

```json
{
  "schemaVersion": 1,
  "headSha": "0123456789abcdef0123456789abcdef01234567",
  "paginationComplete": true,
  "checks": [
    { "name": "test", "conclusion": "success", "headSha": "0123456789abcdef0123456789abcdef01234567" }
  ],
  "reviews": [
    {
      "id": "review-1",
      "reviewerId": "reviewer-1",
      "submittedAt": "2026-01-01T00:00:00.000Z",
      "state": "approved",
      "headSha": "0123456789abcdef0123456789abcdef01234567"
    }
  ],
  "threads": [
    { "id": "thread-1", "isResolved": true, "headSha": "0123456789abcdef0123456789abcdef01234567" }
  ]
}
```

Types found in `packages/governance/src/review/types.ts`; validation rules
found in `packages/governance/src/review/validate.ts`. The optional
`./review/github` subpath (`normalizeGitHubReviewEvidence`) converts a
caller-provided GitHub-shaped payload into this same `ReviewEvidenceBundle`
shape without performing any network request itself.

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
    {
      "name": "@example/core",
      "status": "adopted",
      "qualifiedEvidence": { "reference": "https://example.invalid/ci/core-release-proof", "date": "2026-07-01" },
      "adoptedEvidence": { "reference": "https://example.invalid/consumers/core-integration", "date": "2026-08-01" }
    },
    {
      "name": "@example/legacy-core",
      "status": "deprecated",
      "replacement": { "name": "@example/core", "range": "^1.0.0" },
      "deprecatedOn": "2026-08-11",
      "decision": "https://example.invalid/decisions/core-replacement",
      "migration": "https://example.invalid/migrations/legacy-core",
      "forwardsToReplacement": true
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

### Promotion evidence: `qualifiedEvidence` and `adoptedEvidence`

Reaching `qualified` or `adopted` is evidence-gated exactly like reaching
`deprecated` or `retired` is: a status claim without a citation is not
accepted. Each is an object with the same two durable, checkable fields used
throughout this registry — never a self-attested completion boolean:

| Field | Type | Notes |
| --- | --- | --- |
| `reference` | `string` | A URL or a repo-relative path to something a reader can actually open; non-empty. |
| `date` | `string` | A real calendar date in `YYYY-MM-DD` form. |

An entry with status `qualified` requires `qualifiedEvidence` citing the
owner-defined integration or release proof it passed. An entry with status
`adopted` requires **both** `qualifiedEvidence` and `adoptedEvidence` —
`adopted` means qualified *and* in confirmed consumer use, so the registry
requires proof of each, not just the newer claim. Either field may also be
recorded early (on an `incubating`/`published` entry, before the status
itself is bumped) or retained afterward as historical evidence on a
`deprecated`/`retired` entry — presence is never rejected outside
`qualified`/`adopted`, only required starting there.

### `forwardsToReplacement`

A `deprecated` entry must declare `forwardsToReplacement: true` or `false`,
so a reader of the registry — not just of prose in a decision doc — can tell
"deprecated, but the old import path still resolves to working code" apart
from "deprecated, and importing it is now a hard break requiring a
rewrite" without opening the package's source. `true` means the deprecated
package still ships a real compatibility re-export to its replacement (as
`@vespeneventures/catalog` does, forwarding to
`@vespeneventures/governance/catalog`); `false` means it does not (as
`@vespeneventures/tokens` and `@vespeneventures/voice` do not — their
consolidation removed the source package entirely with no re-export left
behind, so importing either name is an immediate break, not a deprecation
warning). A `retired` entry may also declare it — always `false`, since a
retired package is by definition no longer installable from this workspace —
but is not required to, since that is already implied by the status itself.
It is rejected on any non-terminal status; declaring it early makes no sense
because there is nothing yet to forward.

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
| `PackageLifecyclePromotionEvidence` | type | Durable `{ reference, date }` citation shape used by `qualifiedEvidence` and `adoptedEvidence`. |
| `LifecycleFinding` / `LifecycleFindingRule` | types | Deterministic lifecycle validation result and rule vocabulary. |
| `GovernanceReport` | type | Foundation report, build order, lifecycle findings, and combined status. |
| `NewPackagePlanInput` / `NewPackagePlanProfile` / `NewPackagePlan` / `NewPackagePlanReadiness` / `PackageScaffoldFile` | types | New-package input, repository-owned profile, readiness state, and reviewable generated file plan. |
| `GovernedPreflightOptions` / `GovernedPreflightReport` | types | Options and result for the release-plus-governance preflight. |

## Requirements

Node 20+. ESM only. Exactly one unconditional runtime dependency:
`@vespeneventures/policy`.

TypeScript is not installed by a plain `npm install @vespeneventures/governance`.
It is declared as an optional peer dependency (`peerDependencies` +
`peerDependenciesMeta: { typescript: { optional: true } }`) — the same shape
`@vespeneventures/auth` uses for its own optional peers such as `svix`. A
consumer who never imports `./gates` never installs a compiler on this
package's account, including each of the five compatibility shims that
depend on `governance` and previously inherited it transitively through a
bare `dependencies` entry (issue #152).

TypeScript is needed only for the source-aware secret-surface checks
reachable through `./gates` (`packages/governance/src/gates/secret-gates.ts`
is the sole importer, gated behind that one subpath). A plain `import
"@vespeneventures/governance"` (the root entry) never loads it at runtime
either: `runGovernanceCheck` and `preflightGovernedPackage` import the
specific foundation/build-order functions they need directly, never the
`./gates` barrel those secret-surface checks also live in. If you want the
secret-surface checks, install `typescript` yourself and import
`@vespeneventures/governance/gates` — that subpath still carries the full
TypeScript dependency, unchanged; only the manifest changed, not what any
subpath does at runtime.

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
