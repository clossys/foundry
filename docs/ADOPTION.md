# Consumer adoption ledger

This ledger separates three questions that must not be collapsed:

1. Does a reusable Foundry package already exist in GitHub Packages?
2. Is a reusable, account-neutral capability still missing from Foundry?
3. Is the remaining work deliberately owned by each consuming plane or
   repository?

The lifecycle contract in
[`docs/contracts/package-lifecycle.json`](contracts/package-lifecycle.json) is
the source of truth for release status. This document records adoption shape,
not installed versions, consumer inventory, credentials, or rollout authority.

This ledger applies to the current public producer at
`vespeneventures/foundry`. [#224](https://github.com/vespeneventures/foundry/issues/224)
plans its rename to `vespeneventures/vv-foundry`. A separate account control
plane owns account-scoped inventory and policy; its repository coordinate is
deliberately retained by that owning plane. [#216](https://github.com/vespeneventures/foundry/issues/216)
tracks the integration boundary. This ledger performs neither repository
action.

## Before installing: optional peers install as required on this registry

A consumer planning an install should know this before running one, not
discover it after: `npm.pkg.github.com`'s packument omits
`peerDependenciesMeta` for every version it serves, so every peer a package
declares `optional: true` installs as a hard requirement anyway. This is a
registry-side gap, not a defect in what these packages publish — see
[issue #226](https://github.com/vespeneventures/foundry/issues/226) for the
confirming evidence and [docs/DECISIONS.md](DECISIONS.md#a-standing-property-of-that-registry-optional-peers-install-as-required)
for the decision to document rather than restructure packages around it.

Six packages are affected — five of them in the table below: `ui` (six
optional peers), `auth` (five), `surface` (`react`/`react-dom`), `comms`
(`resend`), and `governance` (`typescript`). The sixth, `consent`
(`react`/`react-dom`), is `incubating` rather than published and so does not
appear in that table, but carries the same behaviour once installed.
Installing any one of them pulls
in its full declared peer set, regardless of which subpath is actually
imported — a consumer wanting only `ui`'s token CSS, or only `comms`'s
provider-neutral root, gets React, Tailwind, or `resend` installed anyway.
Each affected package's own README states the consequence specific to that
package; this entry exists so the pattern is visible before an install is
planned, not only after.

## Published Foundry package candidates

These packages have lifecycle status `published`, but none is an adoption-ready
target until its lifecycle entry records the required qualification evidence.
Issue [#234](https://github.com/vespeneventures/foundry/issues/234) owns that
14-package exact-version install and export or CLI proof; it succeeds
[#213](https://github.com/vespeneventures/foundry/issues/213), which decided
the registry and is closed. After qualification,
a consumer installs only the subset it needs through authenticated GitHub
Packages access.

| Capability | Package or subpath | Consumer-owned remainder |
| --- | --- | --- |
| Authorization primitives | `@vespeneventures/auth` | Principals, grants, policy values, provider clients, and enforcement wiring. |
| Content bindings | `@vespeneventures/policy` | Bound documents, storage, and materialization. |
| Shared conventions | `@vespeneventures/conventions` | Plane overlays, prefixes, repository inventory, skill bodies, and routine tempo. |
| Machine provisioning | `@vespeneventures/provisioning` | Installation manifest, destinations, adapters, and mutation approval. |
| Domain machinery | `@vespeneventures/domain` | Product-owned types, vocabularies, relations, and migrations. |
| Deployment inspection | `@vespeneventures/deployment` | Provider credentials, topology, environment choices, and remediation. |
| Communication contracts | `@vespeneventures/comms` | Recipients, sender identity, templates, consent policy, storage, routes, and provider configuration. |
| Secret resolution | `@vespeneventures/secrets` | Secret catalog, aliases, provider resources, credential references, grants, and rotation policy. |
| Package and repository governance | `@vespeneventures/governance` and its focused subpaths | Profile and requirement values, discovery, precedence, observations, lifecycle decisions, workflow YAML, provider I/O, and any resulting machine mutation. |
| Visual system | `@vespeneventures/ui` | Product theme choices, compositions, and application wiring. |
| Strategy validation | `@vespeneventures/strategy` | Facts, mission, markets, audiences, roadmap, and brand values. |
| Copy validation | `@vespeneventures/copy` | Voice, glossary, claims, templates, and approved words. |
| Channel surfaces | `@vespeneventures/surface` | Routes, build adapters, deployment, and publishing. |
| Outcome ledger | `@vespeneventures/ledger` | Durable storage, current fact values, channel delivery, and operational follow-up. |

`@vespeneventures/consent` remains `incubating`, so it is not an available
registry adoption target. Deprecated compatibility packages remain published
only for migration; after qualification, a newly adopting consumer uses the
lifecycle replacement. Retired names remain reserved and must not be reused or
deleted.

## Reusable capability not yet adoption-ready

| Gap | Foundry owner | Consumer work that remains separate |
| --- | --- | --- |
| Upward repository requirements | [#237](https://github.com/vespeneventures/foundry/issues/237) targets `@vespeneventures/governance@0.9.0` with the neutral v2 declaration grammar and pure evaluator. Consumers must wait for that exact version to be published and qualified; source in a branch or pull request is not an adoption target. Exact workspace-repository root structure and removal of singular control-plane assumptions remain explicitly separate follow-up work in [#238](https://github.com/vespeneventures/foundry/issues/238). | Each account workspace discovers repository declarations, associates opaque source identities, gathers normalized observations, decides precedence, selects any compatible value, and owns every installation or machine mutation. |
| Capability-first skill registry | [#214](https://github.com/vespeneventures/foundry/issues/214) and [#225](https://github.com/vespeneventures/foundry/pull/225) landed the account-neutral schema, validator, vocabulary, and set arithmetic in `@vespeneventures/conventions` 0.3.0 source. Issue [#234](https://github.com/vespeneventures/foundry/issues/234) still requires registry publication and exact-version qualification evidence before consumers treat that capability as available. | Each plane declares required targets, skill coverage, third-party inventory, and accepted exceptions. Routines add cadence only. |
| Workspace-cleanup classification | [#215](https://github.com/vespeneventures/foundry/issues/215) owns the not-yet-qualified pure observation-to-proposal classifier. | Each plane discovers repositories, gathers Git and provider evidence, checks live task ownership, requests exact confirmation, and performs any approved cleanup. |

Until a row has a qualified registry artifact, consumers keep their existing
local implementation. The skill registry is no longer a Foundry source gap,
but it remains an adoption-evidence gap. Consumers must not disguise any such
gap as a routine, a copied skill body, or package-consumption wiring.

## Deliberately consumer-local wiring

| Surface | Why it stays local | Adoption evidence |
| --- | --- | --- |
| GitHub Packages access | Registry mapping and credential references belong to the consuming plane. | Exact package/version in the lockfile plus an authenticated clean install; never a token value. |
| Account control plane | Repository inventory, skill-prefix ownership, local paths, and operator policy are account choices. The current `vespeneventures/foundry` repository remains the public package producer until its planned `vespeneventures/vv-foundry` rename; the separate account control plane does not publish packages, and its coordinate remains plane-owned. | Plane-owned validation. [#216](https://github.com/vespeneventures/foundry/issues/216) tracks the integration boundary and [#224](https://github.com/vespeneventures/foundry/issues/224) owns the public producer rename; neither repository action is authorized or performed here. |
| Repository and review automation | Workflows, protected paths, commands, rulesets, pagination, and provider calls are repository policy and I/O. | Exact-head consumer checks using `@vespeneventures/governance` contracts. |
| Secret operations | Provider projects, aliases, grants, authentication, and rotation are private operational state. | Value-free readiness and consumer-owned first-run evidence. |
| Routes and publishers | Foundry supplies composition and rendering contracts, not product routes, deployment destinations, or send authority. | Consumer route/build tests and channel-specific delivery evidence. |
| Cleanup mutation | A `safe-candidate` classification is never deletion authority. | Exact operator confirmation against current evidence in the owning plane. |

## Adoption rule

A package is adopted only when the consumer can name the exact capability it
needs, install the exact published artifact through its own authenticated
registry configuration, and prove the public export or CLI it actually uses.
The existence of a package does not require installing the suite, and the
existence or cadence of a routine does not prove functional coverage.
