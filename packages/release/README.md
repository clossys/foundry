# @vespeneventures/release

Proof that a package actually installs and works the way a real, external
stranger would install it — with nothing but a registry and whatever the
package itself declared.

Every other check in this small set of packages reasons about *declared*
shape: a manifest says what it depends on, a catalog says whether that
declaration is internally consistent, a policy binding says whether
materialized content matches what was promised. None of that proves the
package actually works once installed with nothing but a registry and its
own `package.json` — a missing dependency, an unpublished internal package,
or a broken `exports` map can all pass every check above and still leave a
consumer with a package that will not load. `release` is that proof: pack
the real tarball, install it into a genuinely isolated temporary directory
with no workspace, no symlinked siblings, and no pre-existing
`node_modules` helping it along, and try to actually load what the package
claims to export.

```bash
npm install @vespeneventures/release
```

## The three capabilities

### 1. Real install-and-import proof — `packRoundTrip`

Packs one package for real (`npm pack`), installs the resulting tarball
into a fresh, isolated temporary directory outside this workspace's own
tree, and attempts to `import` every subpath the packed package's own
`exports` field declares — from a Node process whose module resolution root
is that isolated directory, not this package's own `node_modules`.

```ts
import { packRoundTrip } from "@vespeneventures/release";

const result = await packRoundTrip("packages/policy");
if (!result.ok) {
  for (const finding of result.findings) {
    console.error(`[${finding.severity}] ${finding.rule}: ${finding.message}`);
  }
  process.exitCode = 1;
}
```

Never throws for an expected failure mode. A failed install or a failed
import is a `Finding` on the returned `RoundTripResult`, not an exception —
this function only throws when the operation is meaningless to attempt at
all, such as `packageDir` not containing a `package.json`.

Every `npm pack`, `npm install`, and import-check subprocess runs with a
deliberately minimal environment — `PATH` and `HOME` are passed through,
but credential- and registry-shaped variables (`NODE_AUTH_TOKEN`, any
ambient registry override, and the operator's own `~/.npmrc`) are never
inherited. By default the registry is pinned to the public default. A
package that only resolves because of the operator's own local credentials
is not proof of what an external stranger would actually experience.

Private registry proof is an explicit opt-in: pass `registry.url` and a
caller-supplied `registry.authToken`. The token is injected only into the
isolated npm subprocesses through an ephemeral config file, never read from
the ambient environment, never logged, and removed even when `keepTempDir`
is enabled. This lets a publisher prove a private runtime graph after its
sibling packages are published without weakening the default public-registry
proof. Each subprocess also runs under a finite timeout so a hung install,
or a package whose top-level code never resolves, cannot hang
`packRoundTrip` forever — a timeout is reported as a clear finding, never a
silent, indefinite pass.

When a publisher has already scanned and selected a tarball, pass its path
as `tarballPath`; `packRoundTrip` installs that exact file instead of packing
the source directory again.

A package that declares no importable `exports` surface at all checks zero
imports and is therefore reported `ok: false` with a
`"round-trip-no-exports"` finding, not `ok: true`. Checking nothing proves
nothing about installability.

### 2. Combined preflight — `preflightPackage`

Runs `@vespeneventures/gates`'s own `runFoundationCheck(root, { scope })`,
filters its findings down to the ones attributed to the package at
`packageDir`, and calls `packRoundTrip(packageDir)` — one call, one report,
covering both declared shape and real installability.

```ts
import { preflightPackage } from "@vespeneventures/release";

const report = await preflightPackage(process.cwd(), "packages/policy", { scope: "@your-scope" });
if (!report.ok) {
  for (const finding of report.catalogFindings) console.error(`[${finding.severity}] ${finding.rule}: ${finding.message}`);
  for (const finding of report.roundTrip.findings) console.error(`[${finding.severity}] ${finding.rule}: ${finding.message}`);
  process.exitCode = 1;
}
```

`ok` is `true` only when both halves are clean: `catalogFindings` has no
`"error"`-severity entry, and `roundTrip.ok` is `true`. A package can look
perfectly declared and still fail this if it cannot actually be installed
from outside the workspace, and a package that installs and imports
cleanly can still fail this if its real dependency graph has a problem.

### 3. Published-artifact digest check — `verifyPublishedArtifact`

A thin wrapper around `@vespeneventures/policy`'s own `verifyBinding`.
Builds a `PolicyBinding` for a published tarball (`policyId:
"published-tarball"`, `digestAlgorithm: "sha256"`) and verifies
already-fetched content against an expected digest — no digest comparison
is reimplemented here.

```ts
import { verifyPublishedArtifact } from "@vespeneventures/release";

// The caller already fetched `publishedContent` some other way — a real
// registry download, a GitHub Packages API call. This function does none
// of that fetching itself.
const findings = verifyPublishedArtifact(expectedDigest, publishedContent);
if (findings.length > 0) process.exitCode = 1;
```

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `packRoundTrip(packageDir, options?)` | function | Packs `packageDir`, installs the tarball into an isolated temporary directory, and attempts to import every declared `exports` subpath. Returns a `Promise<RoundTripResult>`. `options.keepTempDir` (default `false`) skips cleanup, for debugging a real failure by hand. |
| `preflightPackage(root, packageDir, options?)` | function | Combines this package's own catalog findings with a real `packRoundTrip` result. Returns a `Promise<PreflightReport>`. `options.scope` is passed straight through to `runFoundationCheck`. |
| `verifyPublishedArtifact(expectedDigest, publishedContent)` | function | Builds a `PolicyBinding` inline and calls `@vespeneventures/policy`'s own `verifyBinding`. Returns a `Finding[]`; empty means the content matches. |
| `PackRoundTripOptions` | type | `{ keepTempDir?: boolean; tarballPath?: string; registry?: RegistryInstallOptions; timeoutsMs?: { pack?: number; install?: number; import?: number } }` — the second argument to `packRoundTrip`. `tarballPath` verifies the already-selected artifact rather than repacking source; `timeoutsMs` overrides the default per-subprocess timeouts. |
| `RegistryInstallOptions` | type | `{ url: string; authToken?: string }` — explicit private-registry proof configuration. Omit it for the default unauthenticated public-registry proof. |
| `PreflightPackageOptions` | type | `{ scope?: string }` — the third argument to `preflightPackage`. |
| `ImportCheck` | type | `{ subpath: string; ok: boolean; error?: string }` — one attempted import of one declared `exports` key. |
| `RoundTripResult` | type | `{ ok: boolean; packageName: string \| undefined; tarballPath: string; imports: ImportCheck[]; findings: Finding[] }` — what `packRoundTrip` returns. `findings` carries rule `"round-trip-tarball-missing"`, `"round-trip-tarball-invalid"`, `"round-trip-install-failed"`, `"round-trip-import-failed"`, or `"round-trip-no-exports"` (a package that declares no importable `exports` subpath at all — checking zero imports is never reported as `ok: true`). |
| `PreflightReport` | type | `{ packageName: string; catalogFindings: CatalogFinding[]; roundTrip: RoundTripResult; ok: boolean }` — what `preflightPackage` returns. |

## Proving a private runtime graph

For a package with private registry siblings, proof follows publish order:

1. Publish the dependency-free leaves.
2. Pack and scan the dependent package exactly once.
3. Use that selected tarball with an explicit private-registry configuration
   to prove an isolated install and every declared import.
4. Publish only after that proof is clean.

For this repository's core graph, `catalog` and `policy` precede `gates`,
and `gates` plus `policy` precede `release`. The exact current availability
of a version is a registry fact, not a source-tree fact; an isolated proof
must therefore be run after the required sibling versions are available.

```ts
const result = await packRoundTrip("packages/gates", {
  tarballPath: "packages/gates/vespeneventures-gates-0.1.0.tgz",
  registry: {
    url: "https://npm.pkg.github.com",
    authToken: registryToken,
  },
});
```

This is still a local-tarball install for the package under proof. Its runtime
dependencies resolve from the configured private registry, so a missing,
incorrectly versioned, or inaccessible sibling fails the real `npm install`
instead of being masked by workspace links.

## Non-goal: publishing and fetching

`release` does not publish anything, and does not fetch anything from a
real registry. `packRoundTrip` installs from a local tarball path — fully
offline as far as this package's own logic is concerned; the only network
activity possible is whatever the packed package's own declared
dependencies would themselves require to resolve, which is precisely the
thing under test, not something this package tries to avoid or route
around. `verifyPublishedArtifact` takes already-fetched content as a plain
argument — where that content came from is entirely the caller's problem,
the same way `@vespeneventures/policy` never reads a file itself.

## Requirements

Node 20+. ESM only. Runtime dependencies: `@vespeneventures/gates`,
`@vespeneventures/policy`.

## Licence

MIT
