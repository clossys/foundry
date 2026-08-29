# Secrets infrastructure architecture

**Historical record — not current package architecture.** This document
records a superseded proposal for `@example/secrets` and
`@example/governance/gates`; neither is a current package install or
publication instruction. The current catalogue and its lifecycle/registry
dispositions are authoritative. It remains only to preserve the reasoning of
the earlier proposal.

## Decision

Foundry owns one secrets package with an explicit provider subpath and extends
the existing gates package:

1. `@example/secrets` owns provider-neutral runtime resolution at its
   root entry and Infisical integration at `@example/secrets/infisical`.
2. `@example/governance/gates` owns pure consumer governance checks.

There is no standalone `secrets-infisical` or `secrets-cli` package. The only
useful command-line operations in this release require Infisical configuration
and semantics, so the provider-specific CLI is shipped by the same package as
the `./infisical` subpath. Splitting it would create an abstraction with no
second provider and move provider branching into a nominally neutral CLI.

There are no separate types, config, or test packages. Core types ship beside
the client, configuration is always injected by the consumer, and the
in-memory adapter is small enough to remain part of the core public contract.

## Ownership map

| Existing responsibility class | Foundry owner | Remains consumer-owned |
| --- | --- | --- |
| Runtime `get`/`require`, process environment default, dependency injection, synchronous compatibility, test double | `@example/secrets` root entry | Which keys an application requests and when startup requires them |
| Provider authentication and secret resolution | `@example/secrets/infisical` | Base URL, project, environment, folder, identity, token source, and provider-side grants |
| Provider run/check/catalog/list/get behavior | `@example/secrets/infisical` | The catalog file, command, environment selection, and CI identity configuration |
| Raw sensitive environment reads | `@example/governance/gates` | Source-file discovery and the explicit adapter exemption |
| Secret naming | `@example/governance/gates` | Consumer key inventory and any added exact sensitive names |
| Credential inventory and surface drift | `@example/governance/gates` | Credential IDs, providers, consuming surfaces, and observation collection |
| Local secret-file prohibition | `@example/governance/gates` | Tracked and on-disk path enumeration |
| Value-free catalog and readiness coverage | `@example/governance/gates` plus the provider client's readiness operation | Required/optional declarations and provider configuration |
| Provider resource naming | `@example/governance/gates` | Provider/kind patterns and observed resource names |
| Credential issuance, revocation, principals, tokens, policies, and grants | No secrets package | Identity/access-control layer and upstream credential authority |
| Repository scaffolding for env and auth conventions | No package in this change | Repository creator or consumer templates, using these public contracts |

Foundry contains machinery only. It must never contain a secret value, a
consumer catalog, provider resource identifier, folder taxonomy, alias,
credential inventory, repository path, or private migration prose.

## Runtime design

The core client is constructed with an adapter. It has no mutable package-wide
adapter registry, which makes concurrent applications and tests independent.
The environment adapter is late-bound and the test adapter exposes key-only
inspection. Synchronous calls remain available for migration, but they fail
explicitly when an async provider is installed.

Provider errors are replaced with stable safe errors instead of being chained.
This intentionally gives up provider response text because a response body or
exception can contain sensitive material.

The Infisical client implements the core adapter contract directly. OIDC and
access-token authentication are token-provider objects, so workloads can
inject tokens from their own runtime without package-global configuration.
List operations request names without values. Readiness returns booleans. Run
keeps values in memory and injects them into one non-shell child process.

## Maintenance and rotation

Read access and mutation are separate constructors. The default Infisical
client cannot write. The maintenance client requires a consumer authorization
callback for every replacement and the provider identity must independently
have least-privilege write access. The CLI exposes no mutation command.

Replacing a stored value is not complete credential rotation. Rotation also
requires issuing a new credential at its upstream authority, verifying a
consumer against it, and revoking the prior credential. Those issuer and
revocation steps belong to the consumer's identity/access-control layer. The
Infisical package owns only a guarded replacement step with optional
verification. It does not automatically roll back a failed verification:
restoring a locally read value can overwrite a concurrent replacement from
another process. Consumers must use provider-side conditional writes or a
distributed lock for coordinated recovery.

This split prevents a generic storage client from claiming authority it does
not have and avoids passing replacement values through terminal arguments.

## Consumer migration

Each adopting repository can migrate independently:

1. Author a value-free version-1 catalog in the consumer repository. Keep all
   provider identifiers, folder choices, aliases, and environment mapping
   beside that consumer.
2. Add `@example/secrets`, construct a client at the composition root,
   and pass it into application code. A temporary local wrapper may retain
   existing `getSecret`/`requireSecret` function names while call sites move.
3. Keep synchronous call sites on `requireSync` only while using a synchronous
   adapter. Move provider-backed paths to async startup before switching them
   to Infisical.
4. Run `detectRawSecretReads` over the consumer's real source inventory. Mark
   only the environment adapter as exempt; every other sensitive raw read is
   migrated to the injected client.
5. Add the `@example/secrets/infisical` subpath at the application
   boundary. Inject base URL, project, environment, path, and token provider
   from consumer runtime configuration.
6. Use OIDC for CI where the execution platform supplies identity tokens.
   Provider-side grants remain scoped to that repository's required project,
   environment, path, and read/run operations.
7. Feed provider readiness booleans into `checkSecretReadiness`, credential
   observations into `checkCredentialSurfaceDrift`, and tracked/on-disk paths
   into `checkLocalSecretFiles`. Fail closed before deployment.
8. Opt into a maintenance client only for a repository that has an explicit
   approval source, least-privilege provider write grant, upstream issuance
   strategy, verification step, and revocation plan.

No migration step copies a value or repository topology into Foundry.
Consumers can share package versions and gate semantics while keeping their
catalogs and provider bindings completely separate.

## Publication order

The publication order is:

1. `@example/governance` version `0.2.0`
2. `@example/secrets` version `0.1.0`

The packages are not published by this change. Each package must independently
pass the repository's FULL tree and artifact safety gates and name-collision
preflight before publication is proposed.
