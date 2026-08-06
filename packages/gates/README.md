# @vespeneventures/gates

Orchestrates `@vespeneventures/catalog` and `@vespeneventures/policy` into
single, useful operations. It adds no new validation rules or binding logic
of its own — every finding a `gates` function returns was produced by
calling `catalog`'s or `policy`'s own functions.

```bash
npm install @vespeneventures/gates
```

## The three capabilities

### 1. Orchestrated validation — `runFoundationCheck`

One call that builds a catalog and evaluates it: nothing new beyond calling
`@vespeneventures/catalog`'s own `buildCatalog` and `evaluateCatalog` in
sequence and returning the result under one name — but it is the thing a
consumer of this package actually wants to call.

```ts
import { runFoundationCheck } from "@vespeneventures/gates";

const report = runFoundationCheck(process.cwd(), { scope: "@your-scope" });
for (const finding of report.findings) {
  console.error(`[${finding.severity}] ${finding.rule}${finding.package ? ` (${finding.package})` : ""}: ${finding.message}`);
}
if (report.findings.some((f) => f.severity === "error")) process.exitCode = 1;

// report.complete is false when buildCatalog could not read or use some
// path (an unreadable directory, a malformed manifest, a missing packages
// directory) — equivalent to checking `report.catalog.skipped.length === 0`
// by hand, but a caller does not have to remember to.
if (!report.complete) console.error(`warning: ${report.catalog.skipped.length} path(s) were not checked`);
```

### 2. Topological build order — `computeBuildOrder`

Computes a deterministic build order from the same internal-dependency graph
`catalog` already reads, using Kahn's algorithm: repeatedly take a ready
package (no unresolved internal dependency remaining), append it to the
order, and remove its outgoing edges.

It does not reimplement cycle or duplicate-name detection. It calls
`evaluateCatalog` first, and if that reports any `dependency-cycle` or
`duplicate-name` finding, returns those findings as the failure instead of
attempting a sort — a cyclic graph has no valid topological order to
compute, and two entries sharing a name make "the" entry named X ambiguous
for the same reason.

An entry with no matching real dependency is treated as having no internal
dependencies. Ties between packages with no dependency relationship to each
other are broken alphabetically by name, so the result is deterministic and
reproducible — the same input catalog always produces the same order, on
any machine, in any run.

```ts
import { runFoundationCheck, computeBuildOrder } from "@vespeneventures/gates";

// runFoundationCheck's catalog is already built — reuse it rather than
// building a second one.
const { catalog } = runFoundationCheck(process.cwd());
const result = computeBuildOrder(catalog);

if (!result.ok) {
  for (const finding of result.findings) console.error(`[error] ${finding.rule}: ${finding.message}`);
  process.exit(1);
}
for (const name of result.order) {
  console.log(name); // build in this order, left to right
}
```

### 3. Orchestrated policy verification — `verifyPolicyBindings`

Given a list of `{ policyId, binding, content }` checks — the caller has
already read whatever file or secret `content` came from; this package does
zero I/O of its own — verifies each binding against its content using
`@vespeneventures/policy`'s own `verifyBinding`, and returns one result per
check, each clearly attributed to its `policyId`.

```ts
import { verifyPolicyBindings } from "@vespeneventures/gates";
import type { PolicyCheck } from "@vespeneventures/gates";

// A CI script reads each document and its binding from wherever they live,
// and hands the already-read bytes to this function — gates never decides
// where a binding declaration lives or how its content gets read.
const checks: PolicyCheck[] = [
  { policyId: "release-checklist", binding: checklistBinding, content: checklistText },
];

const results = verifyPolicyBindings(checks);
for (const result of results) {
  for (const finding of result.findings) {
    console.error(`[${finding.severity}] ${result.policyId}: ${finding.rule} — ${finding.message}`);
  }
}
if (results.some((r) => r.findings.length > 0)) process.exitCode = 1;
```

### The `foundry-check` CLI

This package also ships a command-line entry point, `foundry-check`, a thin
wrapper over `runFoundationCheck`:

```bash
npx foundry-check --scope @your-scope
```

```
Usage: foundry-check [root] [options]

  root                   Directory to check. Defaults to the current working directory.

Options:
  --scope <scope>        Restricts which of a package's real dependencies/peerDependencies count as internal to this catalog.
  --packages-dir <dir>   Directory holding packages, relative to root. Must not be absolute. Defaults to "packages".
  --max-depth <n>        How many directory levels below packages-dir to search. Must be a positive integer. Defaults to 4.
  --help                 Print this message and exit 0.
```

Exit codes: `0` — ran cleanly, no error-severity finding; `1` — ran
cleanly, at least one error-severity finding; `2` — could not run at all
(bad input, or an unexpected failure).

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `runFoundationCheck(root, options?)` | function | Builds a catalog rooted at `root` (via `buildCatalog`) and evaluates it (via `evaluateCatalog`), returning a `FoundationReport`. `options.scope` is passed through to `evaluateCatalog`; `options.packagesDir`/`options.maxDepth` pass through to `buildCatalog`. Does the same I/O `buildCatalog` does, and no more. |
| `computeBuildOrder(catalog, options?)` | function | Computes a deterministic topological build order over an already-built `Catalog`'s internal-dependency graph. Pure — no I/O. Returns a `BuildOrderResult`. `options.scope` filters which real dependencies count as edges. |
| `verifyPolicyBindings(checks)` | function | Verifies a batch of `PolicyCheck`s using `verifyBinding`, returning one `PolicyCheckResult` per check. Pure — no I/O. |
| `FoundationReport` | type | `{ catalog: Catalog; findings: CatalogFinding[]; complete: boolean }` — what `runFoundationCheck` returns. `complete` is `true` exactly when `catalog.skipped` is empty, so a caller can tell a fully-scanned result from one where some path was unreadable or unusable without inspecting `catalog.skipped` itself. |
| `BuildOrderResult` | type | `{ ok: true; order: string[] } \| { ok: false; findings: CatalogFinding[] }` — what `computeBuildOrder` returns. The `findings` on the `false` branch are `evaluateCatalog`'s own `dependency-cycle` and `duplicate-name` finding(s), unchanged — either one makes a valid order impossible to compute. |
| `PolicyCheck` | type | `{ policyId: string; binding: PolicyBinding; content: string \| Uint8Array }` — one input to `verifyPolicyBindings`. |
| `PolicyCheckResult` | type | `{ policyId: string; findings: Finding[] }` — one output of `verifyPolicyBindings`, echoing back the `policyId` of the check it came from. |
| `Catalog`, `CatalogEntry`, `CatalogFinding` | re-exported | From `@vespeneventures/catalog`, so a caller reading a `FoundationReport` or a `BuildOrderResult` never needs a direct dependency on `catalog` just for the types. |
| `Finding`, `PolicyBinding` | re-exported | From `@vespeneventures/policy`, so a caller building a `PolicyCheck` never needs a direct dependency on `policy` just for the types. |

## Non-goal: content safety

`gates` orchestrates `catalog` and `policy` — questions about the *shape* of
a workspace's package graph, and about whether materialized content matches
a committed digest. It has nothing to do with, and never will have anything
to do with, whether a package's *content* is safe to publish: secrets,
committed build output, agent-instruction files, private identity. That is
a separate, deliberately out-of-scope concern, owned entirely by this
repository's own safety-gate scripts — work this package never touches,
never imports from, and never reimplements. A `FoundationReport` with zero
findings says nothing about whether the same tree would pass a
content-safety scan; those are two different, deliberately separate
questions, asked by two different, non-overlapping tools.

## Build-order awareness

`computeBuildOrder` exists to replace a hand-maintained build-order prefix
with a real topological sort computed over the actual dependency graph.
This repository's own root `package.json` currently still hand-maintains
that prefix itself — building the packages with no internal dependencies
first, then running a general pass over everything else — as a stopgap.
Wiring the root build script to call `computeBuildOrder` instead is a
decision for whoever owns that shared file next, not something this package
changes on its own.

## Requirements

Node 20+. ESM only. Runtime dependencies: `@vespeneventures/catalog`,
`@vespeneventures/policy`.

## Licence

MIT
