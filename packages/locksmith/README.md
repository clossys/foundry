# @vespeneventures/locksmith

Locksmith owns keys end to end: custody, distribution, rotation, revocation —
and, unchanged from the package it renames, provider-neutral resolution.
Resolution is one verb of five; nothing in this catalogue used to rotate a
key, so this package's job is to close that gap, not merely to fetch a
value.

```bash
npm install @vespeneventures/locksmith
```

## The job

**Aim** — every live key is owned, current, and revocable.

## Metric

Key age at the ninety-fifth percentile, plus the count of keys with no
recorded owner. `summarizeRotationMetric` computes exactly this pair from a
set of rotation evaluations, so the metric is a function this package ships,
not a promise made only in prose.

## Loop

- **sense** — enumerate declared keys and their last rotation
  (`defineKeyCustody`, `RotationRecord`).
- **judge** — `current` / `stale` / `unowned` / `unverifiable`
  (`evaluateRotation`).
- **act** — emit the rotation queue (`rotationQueue`); this package never
  rotates a key itself and never calls a revocation authority — only the
  plane's own explicit authority does that.
- **learn** — a key that is repeatedly `unverifiable` is a custody gap, not a
  scheduling problem; it shows up in `summarizeRotationMetric`'s owner count
  the same way an unowned key does.

The loop closes when every declared key evaluates to `current`, every key has
a recorded owner, and `summarizeRotationMetric`'s owner count is zero. A key
stuck at `unverifiable` never counts toward that close — it stays visible in
`rotationQueue` until an observation actually resolves it one way or the
other.

**Close condition, for a consuming plane's credential inventory:** this loop
closes on inventory COVERAGE, which is deliberately a weaker claim than
rotation health: every live credential is declared in the plane's own
inventory (`defineKeyCustody`'s entries) and every entry EVALUATES — to
`current`, `stale`, or `unowned` — with `unverifiable` appearing only under
an explicit, recorded opt-out. `stale` and `unowned` do not block this
close; they are the gate's real findings, reported as violations for the
plane to act on. Coverage closing means the loop can SEE everything;
rotation health is the separate, stricter condition the gate then judges,
and conflating the two would let "we know about it" read as "it is fine".
`unverifiable` standing in for "nobody checked" is not a close; that is the
same distinction `evaluateRotation`'s ternary exists to keep visible rather
than let collapse into a quiet pass. The loop reopens the moment a
credential is observed in live use — in a workflow, a runtime environment, a
provider console — that the declared inventory never named: an undeclared
credential is a bigger gap than a stale one, because nothing in this package
can report on a key it was never told about. Issue #326 records the fuller
lifecycle this package is still growing into — naming, inventory, exposure,
rotation, revocation, and expiry distribution all failing closed together —
and this close condition is scoped to the custody-and-rotation slice shipped
today, not a claim that #326 is already done.

## Usage

### Resolution (unchanged)

```ts
import {
  createEnvSecretsAdapter,
  createSecretsClient,
  defineSecretCatalog,
} from "@vespeneventures/locksmith";

const secrets = createSecretsClient(createEnvSecretsAdapter());
const signingKey = await secrets.require("APP_SIGNING_KEY");

const catalog = defineSecretCatalog([
  { key: "APP_SIGNING_KEY", required: true, group: "runtime" },
  { key: "OPTIONAL_WEBHOOK_KEY", required: false, group: "integrations" },
]);
```

`createEnvSecretsAdapter()` reads `process.env` at call time, so tests and
startup code can change the environment after importing the package. It does
not copy the environment or read any key during module evaluation.

For dependency-injected tests:

```ts
import {
  createSecretsClient,
  createTestSecretsAdapter,
} from "@vespeneventures/locksmith";

const adapter = createTestSecretsAdapter({ APP_SIGNING_KEY: "example-value" });
const secrets = createSecretsClient(adapter);

adapter.set("ANOTHER_KEY", "another-value");
adapter.delete("APP_SIGNING_KEY");
```

The test adapter's `keys()` method returns names only. It has no method that
dumps all values.

### Custody

```ts
import { custodyOf, defineKeyCustody, unownedKeys } from "@vespeneventures/locksmith";

const custody = defineKeyCustody([
  { key: "APP_SIGNING_KEY", owner: "team-platform", store: "infisical" },
  { key: "LEGACY_WEBHOOK_KEY", owner: null, store: "environment" },
]);

custodyOf(custody, "APP_SIGNING_KEY"); // { key, owner: "team-platform", store: "infisical" }
unownedKeys(custody); // ["LEGACY_WEBHOOK_KEY"]
```

An owner-less key is `null`, never an empty string, so `unownedKeys` never
has to guess at what counts as unowned.

### Rotation

```ts
import { evaluateRotation, rotationQueue, summarizeRotationMetric } from "@vespeneventures/locksmith";

const evaluation = evaluateRotation(
  { key: "APP_SIGNING_KEY", lastRotatedAt: "2026-05-01T00:00:00.000Z" },
  { key: "APP_SIGNING_KEY", maxAgeDays: 90 },
  custody,
);
// evaluation.state is one of "current" | "stale" | "unowned" | "unverifiable"

rotationQueue([evaluation]); // every key that is not "current"
summarizeRotationMetric([evaluation]); // { p95AgeDays, unownedKeyCount }
```

`RotationState` is exactly four literal states, enforced in the type itself:
a caller cannot express "we think it's probably fine" or collapse
"could not check" into "current". Custody is judged before age: an
`unowned` key reports `unowned` regardless of how recent its last rotation
looks, because ownership is a precondition for trusting any age at all.
`sameDigest` compares two caller-supplied, opaque `digest` strings for
equality — this package never derives a digest from a value, computes a
hash, or stores one; it only echoes back whatever opaque fingerprint the
caller already produced elsewhere.

### Revocation

```ts
import { defineRevocationPath, isRevoked, recordRevocation } from "@vespeneventures/locksmith";

const path = defineRevocationPath({
  key: "APP_SIGNING_KEY",
  authority: "infisical-project:prod",
  procedure: "runbook: rotate-signing-key",
});

const revocation = recordRevocation({
  key: "APP_SIGNING_KEY",
  revokedAt: "2026-08-01T00:00:00.000Z",
  revokedBy: "team-platform",
  reason: "suspected exposure",
});

isRevoked([revocation], "APP_SIGNING_KEY"); // true
```

`defineRevocationPath` records where revocation authority lives; it never
calls it. `recordRevocation` records that a revocation happened; it never
performs one. Credential issuance, revocation, and rotation policy remain
the consumer's identity/access-control layer, exactly as they did before
this rename — this package adds the record-keeping half, not the authority.

### Distribution manifest

```ts
import { defineDistributionManifest, mayResolve, principalsFor } from "@vespeneventures/locksmith";

const distribution = defineDistributionManifest([
  { key: "APP_SIGNING_KEY", principals: ["service-api", "service-worker"] },
]);

mayResolve(distribution, "service-api", "APP_SIGNING_KEY"); // true
principalsFor(distribution, "APP_SIGNING_KEY"); // ["service-api", "service-worker"]
```

The manifest states policy only. It grants nothing by itself and performs no
access check against a live resolver — a consumer's own adapter/provider
boundary is what actually enforces access; this manifest is the declaration
that boundary is checked against.

## Synchronous compatibility

`getSync` and `requireSync` support existing synchronous call sites when the
injected adapter is synchronous. They throw `AsyncSecretAdapterError` if the
adapter returns a promise. New provider-backed code should prefer the async
methods.

```ts
const value = secrets.requireSync("APP_SIGNING_KEY");
```

## Error safety

`MissingSecretError`, `SecretAccessError`, and `AsyncSecretAdapterError`
contain a stable code and the requested key. Adapter exceptions are replaced,
not chained, because a provider error or response body may contain sensitive
material. Applications should log the error code and key, never a resolved
value. `SecretError` is the shared base class; `SecretErrorCode` names the
stable, safe error-code union.

## Infisical subpath and CLI

The root entry remains provider-neutral. Install this package and import the
optional Infisical integration from its explicit subpath when a consumer has
chosen Infisical:

```ts
import {
  createAccessTokenProvider,
  createInfisicalClient,
} from "@vespeneventures/locksmith/infisical";

const infisical = createInfisicalClient({
  baseUrl,
  projectId,
  environment,
  secretPath: "/application",
  accessTokenProvider: createAccessTokenProvider(() => accessToken),
});

const value = await infisical.get("APP_SIGNING_KEY");
```

All provider configuration and tokens are injected by the consumer. The
Infisical client implements `SecretsAdapter`, so it can be passed directly to
`createSecretsClient`. `createOidcTokenProvider` exchanges a consumer-supplied
identity token in memory and caches the short-lived provider token only until
shortly before expiry.

`listSecretNames()` returns names only. `checkCatalog()` returns a value-free
readiness report. `parseValueFreeCatalog()` accepts only strict version-1
catalog metadata. `run()` injects values into one non-shell child process
without writing a file or printing the environment.

The package intentionally keeps the provider-specific CLI name
`vespene-secrets-infisical` unchanged by this rename; it avoids introducing a
misleading neutral CLI for operations that require Infisical configuration.
Its `catalog`, `check`, `list`, `get`, and `run` commands never print secret
values. `get` reports presence only, and the CLI exposes no mutation command.

```text
vespene-secrets-infisical catalog --catalog ./secret-catalog.json
vespene-secrets-infisical check --catalog ./secret-catalog.json
vespene-secrets-infisical list
vespene-secrets-infisical get APP_SIGNING_KEY
vespene-secrets-infisical run -- node server.js
```

For maintenance, `createInfisicalMaintenanceClient(config, authorize)` is a
separate constructor. Each replacement requires a consumer authorization
callback and provider-side least-privilege write permission. An optional
verification callback can check the replacement, but failed verification never
automatically restores a locally read value because that could overwrite a
concurrent update. Credential issuance, revocation, and rotation policy remain
consumer responsibilities for the actual mechanics of issuing and replacing a
credential; this package's own `revocation` and `rotation` modules add the
record-keeping — custody, state, and queueing — around that consumer-owned
authority.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `createSecretsClient(adapter)` | function | Creates a frozen client with async `get`/`require` and sync `getSync`/`requireSync` methods. No mutable global adapter is used. |
| `createEnvSecretsAdapter(source?)` | function | Creates a synchronous adapter over a late-bound environment source. Defaults to `process.env`. |
| `createTestSecretsAdapter(initial?)` | function | Creates a mutable in-memory adapter for tests, with key-only inspection. |
| `defineSecretCatalog(entries)` | function | Returns a detached, frozen `SecretCatalog` with `version: 1`. Catalog entries contain metadata only. |
| `SecretError` | class | Base safe error carrying a `SecretErrorCode` and requested key. |
| `MissingSecretError` | class | Reports an unavailable required key. |
| `SecretAccessError` | class | Replaces an adapter failure without retaining provider error text. |
| `AsyncSecretAdapterError` | class | Reports use of a sync client method with an async adapter. |
| `SecretsAdapter` / `SyncSecretsAdapter` | types | Provider adapter contracts. |
| `SecretsClient` | type | Async and sync client contract returned by `createSecretsClient`. |
| `SecretKey` | type | The string key accepted by adapters and clients. |
| `SecretCatalog` / `SecretCatalogEntry` | types | Value-free catalog metadata contracts. |
| `TestSecretsAdapter` | type | In-memory adapter contract returned by `createTestSecretsAdapter`. |
| `MaybePromise` | type | Adapter return helper for sync or async providers. |
| `SecretErrorCode` | type | Stable safe error-code union. |
| `defineKeyCustody(entries)` | function | Builds a frozen, value-free custody manifest: who owns each declared key and where it lives. |
| `custodyOf(manifest, key)` | function | The custody record for one key, or `undefined` if never declared. |
| `unownedKeys(manifest)` | function | Every declared key with no recorded owner. |
| `KeyCustodyManifest` / `KeyCustodyRecord` | types | Custody manifest and per-key custody metadata contracts. |
| `CustodyStore` | type | The string label naming where a key's value lives; taxonomy is provider-owned, not fixed here. |
| `evaluateRotation(record, policy, custody, now?)` | function | Judges one key's rotation state: `current` / `stale` / `unowned` / `unverifiable`. |
| `rotationQueue(evaluations)` | function | Every key whose state is not `current`. |
| `summarizeRotationMetric(evaluations)` | function | The package metric: p95 key age plus the count of unowned keys. |
| `sameDigest(a, b)` | function | Compares two caller-supplied, opaque rotation digests for equality. |
| `RotationState` | type | The closed four-member state union: `current` \| `stale` \| `unowned` \| `unverifiable`. |
| `RotationPolicy` / `RotationRecord` / `RotationEvaluation` / `RotationMetric` | types | Rotation policy, observed rotation history, judged outcome, and the summarized metric. |
| `defineRevocationPath(path)` | function | Records where revocation authority lives for a key; performs no revocation. |
| `recordRevocation(record)` | function | Builds a frozen, value-free record that a key was revoked. |
| `isRevoked(records, key)` | function | Whether any record revokes the given key. |
| `latestRevocation(records, key)` | function | The most recent revocation record for a key, if any. |
| `RevocationPath` / `RevocationRecord` | types | Revocation-authority pointer and revocation-event metadata contracts. |
| `defineDistributionManifest(entries)` | function | Builds a frozen manifest declaring which principal may resolve which name. |
| `mayResolve(manifest, principal, key)` | function | Whether the manifest declares that a principal may resolve a key. |
| `principalsFor(manifest, key)` | function | Every principal declared for a key. |
| `keysFor(manifest, principal)` | function | Every key declared for a principal. |
| `DistributionManifest` / `DistributionEntry` | types | Distribution manifest and per-key principal-list contracts. |
| `Principal` | type | An opaque identifier for whoever may resolve a key. |

### `@vespeneventures/locksmith/infisical` API

| Export | Kind | Purpose |
| --- | --- | --- |
| `createInfisicalClient(config)` | function | Creates injected read, list, readiness, and child-process injection operations. |
| `createAccessTokenProvider(tokenOrFactory)` | function | Supplies a late-bound access token. |
| `createOidcTokenProvider(options)` | function | Exchanges an injected identity token for a short-lived provider token. |
| `parseValueFreeCatalog(value)` | function | Parses strict non-empty version-1 catalog metadata. |
| `createInfisicalMaintenanceClient(config, authorize)` | function | Creates a separately policy-gated replacement client. |
| `InfisicalError` | class | Safe provider error with stable code, optional status, and optional key. |
| `InfisicalClient` / `InfisicalClientConfig` | types | Provider read, list, readiness, run, and configuration contracts. |
| `InfisicalAccessTokenProvider` / `OidcTokenProviderOptions` | types | Token-provider contracts. |
| `SecretReadinessEntry` / `SecretReadinessReport` | types | Value-free readiness result. |
| `InfisicalRunOptions` / `InfisicalRunResult` | types | Child-process injection inputs and exit result. |
| `InfisicalMaintenanceClient` | type | Permission-gated existing-secret replacement contract. |
| `InfisicalMutationPolicy` / `InfisicalMutationRequest` | types | Consumer authorization callback and non-secret request metadata. |
| `ReplaceSecretOptions` / `ReplaceSecretResult` | types | Optional verification callback and value-free replacement outcome. |
| `InfisicalErrorCode` | type | Stable provider error-code union. |

## Ownership boundary

The root entry owns resolution, custody, rotation, and revocation
record-keeping, and the distribution manifest. It has no provider SDK,
network calls, authentication, global adapter registry, project identifier,
folder convention, or repository topology. The explicit `./infisical`
subpath owns provider integration and its value-safe operational CLI.
Credential issuance, revocation execution, and rotation mechanics belong to
an identity or access-control layer this package never calls — it records
policy and state, and emits a queue; the plane's own explicit authority acts
on it.

## Hard boundaries

No code path in this package reads, logs, prints, or transports a secret
**value**. It handles names, owners, ages, stores, rotation policies,
revocation records, and digests only. Every test is hermetic; no test
resolves a real credential. Scanning for leaked values is a different
package's job and stays there.

## Requirements

Node 20+. ESM only. No runtime dependencies and no Infisical SDK or external
CLI dependency.

## Licence

MIT
