# @vespeneventures/gates

> **Deprecated compatibility package.** New integrations import
> `@vespeneventures/governance/gates`. This package preserves the same root
> API and `foundry-check` command while existing consumers migrate.

Foundation orchestration and pure governance checks. The package's own
`src/index.ts` re-exports from `@vespeneventures/governance/gates` for
workspace checks, build ordering, and binding verification, and it exposes
consumer-supplied secret governance for names, source reads, credential
surfaces, local files, catalog readiness, and provider resource names.

```bash
npm install @vespeneventures/gates
```

## Runtime availability

`gates` has a runtime dependency on `@vespeneventures/governance`.

`governance` itself in turn depends on `@vespeneventures/policy`, so both
must be published to the configured registry before this package can be
installed by an external consumer. A workspace link is useful for
development but is not a substitute for that release order; see
[`docs/PUBLISHING.md`](../../docs/PUBLISHING.md) in the repository for the
isolated-tarball proof used before a dependent package is published.

## The three capabilities

### 1. Orchestrated validation — `runFoundationCheck`

One call that builds a catalog and evaluates it: nothing new beyond calling
`@vespeneventures/governance`'s own `buildCatalog` and `evaluateCatalog` (its
`catalog` subpath) in sequence and returning the result under one name — but
it is the thing a consumer of this package actually wants to call.

## Foundation checks

```ts
import {
  computeBuildOrder,
  runFoundationCheck,
  verifyPolicyBindings,
} from "@vespeneventures/gates";

const report = runFoundationCheck(process.cwd(), { scope: "@your-scope" });
const order = computeBuildOrder(report.catalog, { scope: "@your-scope" });
const policyResults = verifyPolicyBindings(checks);
```

`runFoundationCheck` delegates workspace discovery and evaluation to
`@vespeneventures/governance`'s `catalog` subpath. Its `complete` flag is
false whenever any path was skipped. `computeBuildOrder` refuses cyclic or
duplicate-name catalogs and otherwise returns a deterministic topological
order. `verifyPolicyBindings` delegates each already-read document to
`@vespeneventures/policy` (a real, separate dependency of `governance`, not
of this package directly) and preserves the caller's policy identifier.

## Secret governance

Every secret gate is pure. Callers supply source text, path inventories,
value-free metadata, readiness booleans, or naming rules. These functions do
not resolve values, inspect an environment, walk a repository, authenticate to
a provider, or own principals and grants.

### Raw environment reads and names

```ts
import {
  checkSecretName,
  detectRawSecretReads,
} from "@vespeneventures/gates";

const nameFindings = checkSecretName("APP_SIGNING_KEY");
const readFindings = detectRawSecretReads({
  filePath: "src/config.ts",
  body: sourceText,
});
```

`checkSecretName` requires uppercase underscore-separated keys that begin with
a letter. `detectRawSecretReads` finds sensitive dot and string-bracket
`process.env` access, including optional chaining, and fails computed bracket
or whole-environment access because its sensitivity cannot be classified
statically. Sensitive suffixes are built in; consumers can add exact
names, allow known non-secret names, or explicitly exempt the one adapter
implementation that is supposed to read the environment. `NEXT_PUBLIC_*`
names are ignored. Markdown prose files are not parsed as executable source.
For MDX, executable expression and module blocks are inspected while prose,
inline code, and fenced examples do not create findings.

### Value-free catalog and readiness

```ts
import {
  checkSecretReadiness,
  checkValueFreeSecretCatalog,
} from "@vespeneventures/gates";

const catalog = {
  version: 1,
  entries: [
    { key: "APP_SIGNING_KEY", required: true, group: "runtime" },
  ],
};

const catalogFindings = checkValueFreeSecretCatalog(catalog);
const readinessFindings = checkSecretReadiness(catalog, [
  { key: "APP_SIGNING_KEY", present: true },
]);
```

Catalog entries allow only `key`, `required`, optional `description`, and
optional `group`. Unknown properties are errors, which prevents `value`,
provider response, token, or repository topology fields from slipping into a
catalog. An invoked catalog gate also requires at least one entry, so empty
coverage cannot report a false pass. Readiness observations contain only key and presence. Missing
required keys are errors; missing optional keys are warnings; unregistered or
duplicate observations are errors.

### Credential inventory and surface drift

```ts
import {
  checkCredentialInventory,
  checkCredentialSurfaceDrift,
} from "@vespeneventures/gates";

const inventory = {
  version: 1,
  credentials: [
    {
      id: "example-service",
      secretKey: "EXAMPLE_SERVICE_KEY",
      provider: "example-provider",
      surfaces: ["web", "worker"],
    },
  ],
};

const inventoryFindings = checkCredentialInventory(inventory);
const driftFindings = checkCredentialSurfaceDrift(inventory, observedSurfaces);
```

The inventory names storage references and consuming surfaces only. It has no
value, principal, token, permission, policy, or grant fields. Drift checking
reports both observed-but-undeclared and declared-but-unobserved surfaces. An
invoked inventory gate requires at least one credential entry.
Identity and authorization remain a separate ownership boundary.

### Local secret files

```ts
import { checkLocalSecretFiles } from "@vespeneventures/gates";

const findings = checkLocalSecretFiles([
  { path: ".env", tracked: true },
  { path: "apps/web/.env.local", tracked: false },
  { path: ".env.example", tracked: true },
]);
```

The gate inspects paths only, never file contents. Secret-bearing `.env*`
files are errors whether tracked or merely present; value-free `.example`,
`.sample`, `.template`, and `.dist` files are allowed. A consumer may supply
an exact path allowlist, but no broad implicit exception exists.

### Provider resource names

```ts
import { checkProviderResourceNames } from "@vespeneventures/gates";

const findings = checkProviderResourceNames(
  [{ provider: "example", kind: "project", name: "app-production" }],
  [{ provider: "example", kind: "project", pattern: "[a-z]+-(?:development|production)" }],
);
```

Rules are injected by the consumer and matched as full regular expressions.
Kind-specific rules take precedence over provider-wide rules. An invalid
pattern or a resource with no covering rule fails closed. This package ships
no organization, product, project, environment, or folder names.

## CLI

`foundry-check` remains the workspace foundation CLI:

```text
Usage: foundry-check [root] [options]

  --scope <scope>        Restrict which dependencies count as internal.
  --packages-dir <dir>   Relative package directory. Defaults to packages.
  --max-depth <n>        Positive package discovery depth. Defaults to 4.
  --help                 Print usage.
```

Exit codes are `0` for no error findings, `1` for at least one error finding,
and `2` when the check could not run. Secret gates are programmatic because
each consumer owns how source files, tracked paths, inventories, and provider
observations are collected.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `runFoundationCheck(root, options?)` | function | Build and evaluate a real workspace catalog, with explicit completeness. |
| `computeBuildOrder(catalog, options?)` | function | Return a deterministic dependency order or the catalog findings that make ordering impossible. |
| `verifyPolicyBindings(checks)` | function | Verify already-read content against policy bindings and preserve caller IDs. |
| `checkSecretName(name, path?)` | function | Validate the public uppercase secret-key grammar. |
| `detectRawSecretReads(input, options?)` | function | Find raw sensitive `process.env` reads in supplied source text. |
| `checkValueFreeSecretCatalog(value)` | function | Validate strict metadata-only catalog shape and key uniqueness. |
| `checkSecretReadiness(catalog, observations)` | function | Compare catalog requirements with value-free presence observations. |
| `checkCredentialInventory(value)` | function | Validate value-free credential IDs, storage keys, providers, and surface declarations. |
| `checkCredentialSurfaceDrift(inventory, observations)` | function | Compare declared and observed credential surfaces in both directions. |
| `checkLocalSecretFiles(files, options?)` | function | Report secret-bearing environment paths without reading contents. |
| `checkProviderResourceNames(resources, rules)` | function | Apply consumer-injected full-match naming rules by provider and kind. |
| `FoundationReport` | type | Catalog, findings, and complete-coverage flag from `runFoundationCheck`. |
| `RunFoundationCheckOptions` | type | Scope and catalog-discovery options accepted by `runFoundationCheck`. |
| `BuildOrderResult` | type | Successful order or blocking catalog findings. |
| `PolicyCheck` / `PolicyCheckResult` | types | Attributed policy verification input and output. |
| `SecretGateFinding` | type | Secret gate rule, severity, message, and optional path. |
| `RawSecretReadOptions` | type | Added sensitive names, allowed names, and explicit adapter exemption. |
| `SecretCatalogGateDocument` / `SecretCatalogGateEntry` | types | Value-free catalog shapes accepted by secret gates. |
| `SecretReadinessObservation` | type | Key and presence-only readiness input. |
| `CredentialInventory` / `CredentialInventoryEntry` | types | Value-free credential-to-surface inventory. |
| `CredentialSurfaceObservation` | type | One observed credential and surface pair. |
| `LocalFileObservation` / `LocalSecretFileOptions` | types | Path/tracked input and exact allowlist options. |
| `ProviderResourceObservation` / `ProviderResourceNamingRule` | types | Consumer resource metadata and naming pattern. |
| `Catalog` / `CatalogEntry` / `CatalogFinding` | re-exported types | Catalog result contracts. |
| `Finding` / `PolicyBinding` | re-exported types | Policy result and binding contracts. |

## Boundary from Foundry's publication safety

These consumer-facing secret gates do not replace this repository's
`check-public-safety` or artifact scan. Publication safety inspects this public
tree and packed tarballs for forbidden files, credential-shaped material, and
private identity. The package APIs above validate consumer-supplied metadata
and observations. Both layers are necessary and deliberately have different
inputs.

## Requirements

Node 20+. ESM only. Runtime dependency: `@vespeneventures/governance`
(`~0.9.0`).

This package is not dependency-free: `governance` itself depends on
`@vespeneventures/policy`, which is therefore pulled in transitively by
installing this package too.

## Licence

MIT
