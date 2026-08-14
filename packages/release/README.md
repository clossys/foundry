# @vespeneventures/release

> **Deprecated compatibility package.** New integrations import
> `@vespeneventures/governance/release`. This package preserves the same root
> API while existing consumers migrate.

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
tree, and checks every subpath the packed package's own `exports` field
declares. JS/TS runtime targets are imported from a Node process whose module
resolution root is that isolated directory, not this package's own
`node_modules`. Static assets such as CSS and JSONC are valid exports too, so
they are checked for presence in the packed install rather than incorrectly
being handed to Node as JavaScript.

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
inherited, and the registry is pinned to the public default. A package that
only resolves because of the operator's own local credentials is not proof
of what an external stranger would actually experience. Each subprocess
also runs under a finite timeout so a hung install, or a package whose
top-level code never resolves, cannot hang `packRoundTrip` forever — a
timeout is reported as a clear finding, never a silent, indefinite pass.

By default dependency and peer resolution uses `https://registry.npmjs.org/`.
Pass `packRoundTrip(packageDir, { registry })` only when the package is meant
to resolve from a different, anonymously readable registry. The caller's
ambient npm configuration and credentials are never inherited either way.
That means a registry which requires `read:packages` or another token cannot
produce a clean anonymous round trip until it offers an intentionally
unauthenticated install path; this verifier reports that boundary rather than
borrowing the operator's login.

A package that declares no `exports` surface at all checks zero exports and
is therefore reported `ok: false` with a
`"round-trip-no-exports"` finding, not `ok: true`. Checking nothing proves
nothing about installability.

A wildcard subpath (`"./documents/*": "./documents/*"`) is standard Node
`exports` syntax and is not a path — nothing on disk is ever named
`documents/*`. It is verified by expanding its target against the files the
installed tarball actually shipped, then checking each expansion the way any
other subpath is checked. A wildcard that expands to nothing exports nothing
to a consumer and is reported `ok: false` with a
`"round-trip-pattern-unmatched"` finding, so expanding a pattern is never a
way to stop checking it.

For a package with at least one executable JS/TS export,
`packRoundTrip` also installs every declared `peerDependencies` entry using
its declared range before import checks. That makes the executable proof a
peer-satisfied consumer environment instead of relying on optional peer
installation behavior. A static-only package has nothing to execute, so its
asset-presence proof does not install peers merely to check CSS, JSON, JSONC,
or similar files.

For exports that need Next.js rather than raw Node's ESM loader, pass the
explicit `next` option with the applicable client, server, and proxy subpaths.
`release` creates an isolated App Router fixture, installs the package's
declared peers, and runs `next build`; this is a framework compilation proof,
not a request or provider-configuration test. All other exports continue to
use raw Node imports.

The check also verifies every declared TypeScript `types`/`typings` target is
present in the installed tarball. When an export explicitly includes a
CommonJS `require` condition, it executes that branch too; a bare ESM/default
export is not assumed to promise CommonJS support.

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
| `packRoundTrip(packageDir, options?)` | function | Packs `packageDir`, installs the tarball into an isolated temporary directory, imports ESM exports, executes explicitly advertised CommonJS branches, compiles configured Next exports in an isolated App Router fixture, checks static assets and declaration-file targets for packed-file presence, and installs declared peers before executable checks. Returns a `Promise<RoundTripResult>`. `options.keepTempDir` (default `false`) skips cleanup; `options.registry` overrides the anonymous dependency registry. |
| `preflightPackage(root, packageDir, options?)` | function | Combines this package's own catalog findings with a real `packRoundTrip` result. Returns a `Promise<PreflightReport>`. `options.scope` is passed through to `runFoundationCheck`; `options.roundTrip` is passed to the isolated packed-install proof. |
| `verifyPublishedArtifact(expectedDigest, publishedContent)` | function | Builds a `PolicyBinding` inline and calls `@vespeneventures/policy`'s own `verifyBinding`. Returns a `Finding[]`; empty means the content matches. |
| `PackRoundTripOptions` | type | `{ keepTempDir?: boolean; registry?: string; next?: { clientSubpaths?: string[]; serverSubpaths?: string[]; proxySubpaths?: string[] }; timeoutsMs?: { pack?: number; install?: number; import?: number; next?: number } }` — the second argument to `packRoundTrip`. `next` moves only the named exports from raw Node imports into an isolated Next build; `registry` replaces the anonymous public-default registry without inheriting host auth. |
| `RegistryInstallOptions` | type | `{ url: string; authToken?: string; scope?: string }` — authenticated scoped-registry configuration for an isolated round trip. The token is passed only to child npm processes and is never inherited from the host environment. |
| `PreflightPackageOptions` | type | `{ scope?: string; roundTrip?: PackRoundTripOptions }` — the third argument to `preflightPackage`; `roundTrip` passes registry/timeout options through without weakening isolation. |
| `ImportCheck` | type | `{ subpath: string; mode: "import" \| "require" \| "next-build" \| "static" \| "pattern"; ok: boolean; error?: string }` — one export check: an ESM import, explicitly advertised CommonJS require branch, Next build, static-file presence check, or the expansion of a wildcard subpath against the files the tarball actually shipped. |
| `DeclarationCheck` | type | `{ subpath: string; target: string; ok: boolean; error?: string }` — one declared TypeScript target checked for presence in the isolated install. |
| `RoundTripResult` | type | `{ ok: boolean; packageName: string \| undefined; tarballPath: string; imports: ImportCheck[]; declarations: DeclarationCheck[]; findings: Finding[] }` — what `packRoundTrip` returns. `findings` can additionally carry `"round-trip-require-failed"`, `"round-trip-pattern-unmatched"`, or `"round-trip-declaration-missing"`; checking zero exports is never reported as `ok: true`. |
| `PreflightReport` | type | `{ packageName: string; catalogFindings: CatalogFinding[]; roundTrip: RoundTripResult; ok: boolean }` — what `preflightPackage` returns. |

## What this actually found, in this repository

This mechanism's proof is not hypothetical. `@vespeneventures/governance`'s
own test suite — the real implementation this shim package's `src/index.ts`
re-exports from — exercises it against real packages in this repository.

**The clean case: `packages/policy`.** Zero runtime dependencies. Packed,
installed into a genuinely isolated directory with no workspace file at
all, and every declared export subpath imports without error.
`packRoundTrip` returns `ok: true`.

**The general case this mechanism exists for.** A package whose
`package.json` declares a real npm dependency on another package in this
scope — this very shim package's own manifest, for example, depends on
`@vespeneventures/governance` — only proves installable from outside the
workspace once that dependency is actually published to the configured
registry. Packed and installed into a directory with no workspace file and
no sibling `node_modules` to fall back on, an unpublished dependency has
nowhere to resolve from, and the install fails for real, with a real
non-zero exit code from a real `npm install`. `packRoundTrip` returns
`ok: false` with a `"round-trip-install-failed"` finding, and the import
step never runs at all, because there is nothing installed to import.

That is not a bug in the dependent package. Every earlier check can say a
package's manifest and catalog entry are fine while still missing that
installing it from outside the workspace, today, does not actually work —
because a real npm dependency has to actually be published before anything
depending on it can be proven installable from outside the workspace.

The same reporting applies to a package that depends on another package that
has not reached the configured registry yet: its isolated install should be
reported as `"round-trip-install-failed"`, not papered over with workspace
links or local tarballs for its dependencies. Publish the dependency chain,
then rerun the round trip.

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

Node 20+. ESM only. Runtime dependency: `@vespeneventures/governance`
(`^0.7.0`), which this package's own `src/index.ts` re-exports from.

This package is not dependency-free: `governance` itself depends on
`@vespeneventures/policy`, which is therefore pulled in transitively by
installing this package too.

## Licence

MIT
