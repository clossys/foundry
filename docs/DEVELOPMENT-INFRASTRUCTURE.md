# Development infrastructure boundaries

Reusable development infrastructure is split by who can safely own and evolve
it. The split prevents a public package from becoming a transport for a
consumer's policy values or a machine's authenticated state.

| Owner | Owns |
| --- | --- |
| Foundry | Public-safe schemas, validators, CLIs, template or generator machinery, and provider adapters with meaningful provider-specific behavior. |
| Workspace | Repository discovery and inventory, requirement aggregation and precedence, normalized machine observations, user and machine account choices, connector and browser routing, local installation manifests, credentials references, and native session configuration. |
| Consumer repository | Workflow YAML, branch and ruleset policy, protected paths, commands, upward requirement declarations, and project-specific values. |

Credentials, cookies, OAuth grants, session state, and private organization or
customer values do not enter Foundry.

## Package consumption

GitHub Packages is Foundry's current canonical registry. A consuming plane owns its
authenticated scope mapping, credential reference, and local or CI injection;
Foundry owns none of those values. A consumer installs only the packages its
repository actually needs, never the full suite by default. Package
availability, missing reusable capability, and consumer-local wiring are kept
separate in [ADOPTION.md](ADOPTION.md).

## Package boundaries

`@vespeneventures/controller/repository` and
`@vespeneventures/controller/review` are subpaths of the single current
Controller artifact. They share its implementation and release identity;
consumers select only the subpath contracts their repository needs.

`@vespeneventures/controller/repository` owns a provider-neutral contract for
consumer-authored repository values and upward requirements. It validates
declarations and purely evaluates caller-normalized observations without I/O.
It does not discover repositories or machines, choose precedence or compatible
values, install files, produce a provisioning manifest, or mutate a consumer.

`@vespeneventures/controller/review` owns provider-neutral contracts and validation for
review evidence: requests, findings, dispositions, threads, checks, decisions,
and exact-head freshness. Its root export remains vendor-neutral. Meaningful
GitHub evidence translation belongs at `@vespeneventures/controller/review/github`; it
does not warrant a separate `review-github` or generic `github` package.

`@vespeneventures/controller/gates` remains the orchestration subpath for
catalog and policy checks. It is not a runtime dependency of the repository
or review contracts, and neither contract becomes a general gate runner.

The following provider surfaces remain evidence-gated:

- Codex, Claude, and CodeRabbit receive `review` subpaths only when they add
  meaningful provider-specific translation, invocation, or evidence parsing.
  Fixed mention strings and workflow configuration remain consumer-local.
- A separate provider package is justified only by a real dependency,
  credential/runtime boundary, independent release cadence, incompatible peer
  requirements, or material size or ownership pressure. A package that merely
  re-exports a review type is not sufficient.

This avoids both a monolithic development package and a family of empty
provider wrappers.

## Adoption and retirement

The current Controller artifact is `@vespeneventures/controller@0.8.19`. A
consumer qualifies the relevant Controller subpaths by authoring its own
profile and validating that profile in the consumer's existing check path.
The historical standalone names are already retired; they neither run beside
Controller nor provide current compatibility paths.

The single-artifact registry-install and CLI qualification procedure is documented in
[REPOSITORY-REVIEW-FIRST-RUN.md](REPOSITORY-REVIEW-FIRST-RUN.md). It stops
before consumer workflow wiring, provider credentials, and consumer policy
decisions.

The legacy standalone package names are retired historical identities, not
compatibility entry points. Their lifecycle and registry disposition is derived
from the current package contracts; no consumer installs them for this flow.
