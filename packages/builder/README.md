# @vespeneventures/builder

Declared reality made actual. A runtime pin, a machine manifest, and a
deployment target are the same statement at three altitudes — *this is what
should exist; go and see whether it does.* This package holds the manifest
engine, the deployment surface contract, the toolchain pin, the shared
`liveStateSurface` reconciliation contract all three of those sit on, and the
CI gate mechanics that reconcile any of them for real.

```bash
npm install @vespeneventures/builder
```

## The job

Builder owns the gap between what a plane declared and what the machine, the
platform, or the pipeline actually is — whether the subject is a toolchain, a
manifest, or a deployment target. It never guesses and it never lets a
green offline check stand in for a live answer it never actually checked.

## `liveStateSurface` (#255)

Three unrelated subjects — a manifest's destinations, a deployment target's
health, a toolchain's runtime — turn out to share one structure:

- a **declaration** of intent, checkable offline;
- a **live state** owned by somewhere else;
- a **reconciliation surface** that may or may not exist yet;
- and a failure mode where the offline check goes green and gets mistaken
  for the whole answer.

`LiveStateSurfaceDeclaration` is that declaration, with every field the two
tiers that motivated this contract already used in practice:

```ts
import { validateLiveStateSurfaceDeclaration } from "@vespeneventures/builder";

const findings = validateLiveStateSurfaceDeclaration({
  store: "the GitHub Actions branch-protection API",
  readableByScript: true, // explicit, never left implicit
  readableBy: "policy-drift.mjs",
  note: "A green run here is not evidence this is live — only policy-drift.mjs reading the real API says that.",
});
```

`readableByScript: false` requires `reconciledBy` instead of `readableBy` —
what reconciles this subject when a script cannot read it at all. `note` is
required either way, and `validateLiveStateSurfaceDeclaration` rejects a note
that does not actually state the caveat: a green offline check is never
evidence the declared thing is live.

### The finding-kind vocabulary, all five

```ts
import { LIVE_STATE_SURFACE_FINDING_KINDS } from "@vespeneventures/builder";
// [
//   "declared-but-not-live",
//   "live-but-not-declared",
//   "live-differs-from-declared",
//   "live-artifact-predates-its-declaration",
//   "declared-but-not-verifiable",
// ]
```

The first four are what a completed reconciliation attempt can report as
drift. The fifth is different in kind, not degree, and is the point of the
whole contract: a reconciliation surface that cannot currently read live
state is a declared gap with a **named blocker**, never a silent pass.

### Three states, enforced in the types

`reconcileLiveState` returns exactly one of `verified` / `drifted` /
`could-not-verify` — never a boolean, and never a fourth state. This reuses
`@vespeneventures/controller/gates`'s `GateResult` ternary rather than
inventing a fifth shape of the same idea inside this package. The
`could-not-verify` constructor enforces the "named blocker" rule at
construction time, not merely by convention:

```ts
import { liveStateCouldNotVerify, reconcileLiveState } from "@vespeneventures/builder";

liveStateCouldNotVerify("deployment.web", ""); // throws — never a silent pass

const report = reconcileLiveState<string, string>({
  subject: "toolchain.runtime.node",
  declared: { value: "20.11.1" },
  observation: { attempted: true, live: "18.19.0" },
  agrees: (declared, live) => declared === live,
});
// report.result.verdict === "violated"
// report.result.findings[0].kind === "live-differs-from-declared"
```

## Manifest engine (formerly `@vespeneventures/provisioning`)

An idempotent engine for applying a provisioning manifest to a machine, and
for checking afterwards whether the machine still agrees with it. The engine
is neutral machinery: it applies manifests and owns none, and it has no
opinion about what belongs in one.

```ts
import {
  applyInstallation,
  createNodeFileSystem,
  createRuntimeContext,
  loadManifest,
  planInstallation,
  verifyInstallation,
} from "@vespeneventures/builder";

const manifest = loadManifest(JSON.parse(rawManifestJson));
const runtime = createRuntimeContext(manifest, { home: os.homedir(), sourceRoot: myCanonicalCheckout });

// Pure. Touches no filesystem, so it can be printed or reviewed first.
const plan = planInstallation(manifest, runtime);

const fs = createNodeFileSystem();
const result = applyInstallation(plan, fs, { backupRoot: `${runtime.home}/.config-backups/${stamp}` });

// Later, or in a drift check: reads the machine, not the manifest.
const findings = verifyInstallation(plan, fs);
```

`links`, `copies`, `managedBlocks`, and `privateDirectories` are the four
manifest collections; `expandTokens` resolves `${HOME}`, `${SOURCE_ROOT}`,
`${WORKSPACE_ROOT}`, and any `extraTokens` a caller supplies.
`composeManagedBlock`, `renderManagedBlock`, `withoutManagedBlock`, and
`hasExactlyOneBlock` operate on the marker-delimited region a managed block
owns inside a file this engine does not otherwise own.

**Safety properties**, unchanged from `provisioning`: nothing is overwritten
before it is backed up (`ApplyOptions.backupRoot` is required); private
directories are handled first; a `links` entry declared with `target`
(a chained link) applies last, after copies and managed blocks; a same-content
symlink at a copy destination is replaced rather than accepted; ambiguous
managed-block markers are refused, not guessed; applying throws, verifying
reports.

## Deployment (`./deployment` subpath, formerly `@vespeneventures/deployment`)

Dependency-free deployment surface contracts, configuration planning, health
evaluation, and read-only Vercel and Render adapters — preserved as a
subpath rather than flattened into the root entrypoint, so its own export
shape (a root plus two provider subpaths) stays intact.

```ts
import {
  defineDeploymentManifest,
  evaluateDeploymentHealth,
  validateDeploymentManifest,
} from "@vespeneventures/builder/deployment";
import { createVercelInspector, renderVercelConfiguration } from "@vespeneventures/builder/deployment/vercel";
import { createRenderInspector, renderRenderConfiguration } from "@vespeneventures/builder/deployment/render";

const manifest = defineDeploymentManifest({
  schemaVersion: "1",
  surfaces: [{ id: "web", provider: "vercel", environment: "production", health: { kind: "http", url: "https://example.com/health" } }],
});

if (validateDeploymentManifest(manifest).length > 0) throw new Error("Invalid manifest");

const health = evaluateDeploymentHealth([{ surfaceId: "web", status: "healthy" }]);
```

The provider adapters make GET requests only, obtain a bearer token from a
caller-injected provider at inspection time, and never read a secret store or
process environment. See the module doc comments under `src/deployment/`
for the full contract each subpath ships — the shape is unchanged from
`@vespeneventures/deployment`'s own README, which this package's history
carries forward.

## Toolchain

The runtime pin, the package-manager pin, and the build order, expressed and
reconciled as the same `liveStateSurface` statement everything else in this
package makes. A pin is an exact value — never a range; see `src/toolchain.ts`
for why guessing at range syntax this module does not parse would be worse
than refusing to.

```ts
import { reconcileToolchain, validateToolchainDeclaration } from "@vespeneventures/builder";

const declaration = {
  runtime: { name: "node", version: "20.11.1" },
  packageManager: { name: "npm", version: "10.5.0" },
  buildOrder: { packages: ["core", "adapters", "app"] },
};

if (validateToolchainDeclaration(declaration).length > 0) throw new Error("Invalid toolchain declaration");

const [runtime, packageManager, buildOrder] = reconcileToolchain(declaration, {
  runtime: { attempted: true, live: process.version },
  packageManager: { attempted: true, live: "10.5.0" },
  buildOrder: { attempted: true, live: declaration.buildOrder.packages },
});
```

This package never reads `process.version`, spawns a shell, or reads a root
manifest itself — every observation is supplied by the caller. A function
that read its own runtime could never be tested for the disagreeing case
without actually running on a disagreeing machine.

## Shared CI gate mechanics (#257)

The same secret-scan-shaped CI gate had been built independently at least
four times across this account family with no channel between the copies —
a fix discovered in one copy had no way to reach the other three. #257 asks
for that mechanism to live in one place, shipped as **importable machinery a
consumer's own thin workflow invokes** — the shape
`@vespeneventures/verify-standards` already proves — rather than as a
cross-repository reusable workflow reference. A `uses:` pointing at another
account's workflow or action is not the sanctioned exception this account
family's cross-account boundary rule allows; a downstream package depending
on an upstream package is, and that is what this subpath ships.

`./ci` holds the shared half — a fold from any number of `LiveStateSubjectReport`
values into one `0`/`1`/`2` exit-code verdict (`foldLiveStateReports`), plus a
minimum-safe-version staleness floor (`checkVersionFloor`) that gives a caller
running a pre-fix build the same "you are behind" signal
`@vespeneventures/verify-standards` already ships, not merely a changelog
entry someone may or may not read — and the concrete gate built on both:
`builder-verify-toolchain`, an installed CLI a consuming repository's own
thin GitHub Actions workflow runs. See
[`documents/caller-workflow.md`](documents/caller-workflow.md) for that
workflow in full, including why the decisive command must never sit on the
left side of a pipe under GitHub Actions' `bash -e {0}` (`pipefail` unset)
and why "can't run here" must become an exit `2`, never an `if:` skip — a
skipped required check reports to a merge gate as satisfied, not absent.

```bash
npx builder-verify-toolchain --inputs verify-toolchain-inputs.json
# Exit codes: 0 = verified, 1 = drifted, 2 = could not verify.
```

The same fold and floor are also importable directly, for a future gate over
a different subject that wants this package's mechanics without shelling out
to the installed binary:

```ts
import { checkVersionFloor, foldLiveStateReports } from "@vespeneventures/builder/ci";
```

Every check here is hermetic: `src/ci/*.test.ts` injects every declaration,
observation, and file read, and calls no network and no real machine.

## Metric

**Drift**: the count of subjects where declared and actual disagree, plus,
reported separately, the count that could not be verified at all. Neither is
folded into the other — a build that reports zero drift by refusing to look
at half its subjects has not reported zero drift.

## Loop

- **aim** — every declared subject (a manifest destination, a deployment
  surface, a toolchain pin) exists as declared.
- **sense** — read the live state, not the declaration.
- **judge** — `verified` / `drifted` / `could-not-verify`.
- **act** — apply idempotently where the plane granted authority
  (`applyInstallation`); otherwise report the gap with its blocker named
  (`liveStateCouldNotVerify`).
- **learn** — a subject that is repeatedly `declared-but-not-verifiable` is a
  missing credential or a missing API, filed as a named absence rather than
  worked around inside this package.

The loop closes when a plane's own dashboard shows zero `drifted` subjects
**and** zero `could-not-verify` subjects for a given run — not when it shows
zero `drifted` alone, which is exactly the "nobody looked" result this
package's whole design exists to keep from reading as "looks fine."

## API

| Export | Kind | Description |
| --- | --- | --- |
| `loadManifest(raw)` | function | Validates a parsed provisioning manifest and returns it normalized |
| `createRuntimeContext(manifest, options)` | function | Resolves the home directory, source root, workspace root, and token table |
| `planInstallation(manifest, runtime)` | function | Resolves every manifest entry to absolute paths with no filesystem access |
| `expandTokens(value, tokens)` | function | Expands `${TOKEN}` placeholders; throws on an unknown token |
| `applyInstallation(plan, fs, options)` | function | Applies a plan through the injected port, backing up every replaced destination |
| `verifyInstallation(plan, fs)` | function | Reads the machine and returns `Finding[]` |
| `createNodeFileSystem()` | function | The default `FileSystemPort`, backed by `node:fs` |
| `renderManagedBlock(body, start, end)` | function | The marker-delimited block text |
| `withoutManagedBlock(contents, start, end)` | function | Content with the managed region removed |
| `composeManagedBlock(existing, body, start, end, legacyBody?)` | function | The exact content a destination should hold |
| `hasExactlyOneBlock(contents, body, start, end)` | function | Whether a destination holds exactly one well-formed copy of a block |
| `PRIVATE_DIRECTORY_MODE` | `number` | `0o700` |
| `LIVE_STATE_SURFACE_FINDING_KINDS` | constant | All five finding kinds, frozen |
| `validateLiveStateSurfaceDeclaration(declaration)` | function | Validates one `LiveStateSurfaceDeclaration`'s own shape |
| `reconcileLiveState(input)` | function | Reconciles one subject's declaration against one observation; returns a `LiveStateSubjectReport` |
| `liveStateVerified(subject)` / `liveStateDrifted(subject, findings)` / `liveStateCouldNotVerify(subject, blocker)` | function | The only three constructors of a `LiveStateSubjectReport` |
| `liveStateReconciliationReasons` | constant | The `declared-but-not-verifiable` reason vocabulary, scoped via `createGateReasons` |
| `validateRuntimePin(pin)` / `validatePackageManagerPin(pin)` / `validateBuildOrderPin(pin)` | function | Validate one toolchain pin's own shape |
| `validateToolchainDeclaration(declaration)` | function | Validates all three toolchain pins at once |
| `reconcileToolchain(declaration, observation)` | function | Reconciles a declared toolchain against one machine observation; returns three `LiveStateSubjectReport`s |
| `Finding` / `Severity` | type | `{ rule, severity, message }` and `"high" \| "medium" \| "low"` |
| `Manifest` / `LinkEntry` / `CopyEntry` / `ManagedBlockEntry` / `PrivateDirectoryEntry` | type | The four manifest collections and their entries |
| `RuntimeContext` / `RuntimeOptions` / `Plan` / `PlanOperation` / `OperationKind` | type | Runtime resolution and planning shapes |
| `FileSystemPort` / `FileStats` | type | The injected filesystem interface |
| `ApplyOptions` / `ApplyResult` | type | `{ backupRoot }` and `{ changed, unchanged, backupRoot }` |
| `LiveStateSurfaceDeclaration` | type | The `store` / `readableByScript` / `readableBy` / `reconciledBy` / `note` declaration |
| `LiveStateSurfaceFindingKind` / `LiveStateDriftKind` | type | All five kinds, and the four a completed attempt can report |
| `LiveStateFinding` / `LiveStateSubjectReport` / `LiveStateReconciliationResult` / `LiveStateReconciliationReason` | type | One finding, one subject's report, and the underlying `GateResult` shapes |
| `LiveStateObservation` / `LiveStateDeclarationValue` / `ReconcileLiveStateInput` | type | What `reconcileLiveState` reads |
| `RuntimePin` / `PackageManagerPin` / `BuildOrderPin` / `ToolchainDeclaration` / `ToolchainObservation` | type | The toolchain declaration and observation shapes |

`./deployment`, `./deployment/vercel`, `./deployment/render`, and `./ci` are
separate package subpaths, documented in their own sections above.

## Requirements

Node.js >= 20, ESM. Runtime dependency: `@vespeneventures/controller` (`~0.1.0`), for the `GateResult` ternary the `liveStateSurface` and CI-mechanics modules build on rather than reinvent.

## Licence

MIT
