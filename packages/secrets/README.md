# @vespeneventures/secrets

Provider-neutral secret resolution for Node applications. The package exposes
an injected client, an environment adapter, an in-memory test adapter,
value-free catalog types, synchronous compatibility, and errors that name a
failed key but never include a secret value or a provider response.

```bash
npm install @vespeneventures/secrets
```

## Usage

```ts
import {
  createEnvSecretsAdapter,
  createSecretsClient,
  defineSecretCatalog,
} from "@vespeneventures/secrets";

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
} from "@vespeneventures/secrets";

const adapter = createTestSecretsAdapter({ APP_SIGNING_KEY: "example-value" });
const secrets = createSecretsClient(adapter);

adapter.set("ANOTHER_KEY", "another-value");
adapter.delete("APP_SIGNING_KEY");
```

The test adapter's `keys()` method returns names only. It has no method that
dumps all values.

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
value.

## Infisical subpath and CLI

The root entry remains provider-neutral. Install this package and import the
optional Infisical integration from its explicit subpath when a consumer has
chosen Infisical:

```ts
import {
  createAccessTokenProvider,
  createInfisicalClient,
} from "@vespeneventures/secrets/infisical";

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
`vespene-secrets-infisical`; it avoids introducing a misleading neutral CLI
for operations that require Infisical configuration. Its `catalog`, `check`,
`list`, `get`, and `run` commands never print secret values. `get` reports
presence only, and the CLI exposes no mutation command.

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
consumer responsibilities.

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

### `@vespeneventures/secrets/infisical` API

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

The root entry owns resolution contracts and has no provider SDK, network
calls, authentication, global adapter registry, project identifier, folder
convention, or repository topology. The explicit `./infisical` subpath owns
provider integration and its value-safe operational CLI. Principals, token
issuance, permissions, and grant policy belong in an identity or access-control
layer.

## Requirements

Node 20+. ESM only. No runtime dependencies and no Infisical SDK or external
CLI dependency.

## Licence

MIT
