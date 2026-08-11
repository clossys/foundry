# Development infrastructure boundaries

Reusable development infrastructure is split by who can safely own and evolve
it. The split prevents a public package from becoming a transport for a
consumer's policy values or a machine's authenticated state.

| Owner | Owns |
| --- | --- |
| Foundry | Public-safe schemas, validators, CLIs, template or generator machinery, and provider adapters with meaningful provider-specific behavior. |
| Workspace | User and machine account choices, connector and browser routing, local installation manifests, credentials references, and native session configuration. |
| Consumer repository | Workflow YAML, branch and ruleset policy, protected paths, commands, and project-specific values. |

Credentials, cookies, OAuth grants, session state, and private organization or
customer values do not enter Foundry.

## Package boundaries

`@vespeneventures/repository` and `@vespeneventures/review` are a paired
implementation, release, and adoption train. They remain separately
installable and independently versioned.

`@vespeneventures/repository` owns a provider-neutral contract for
consumer-authored repository values and validates those values without I/O. It
does not install files or choose values for a consumer.

`@vespeneventures/review` owns provider-neutral contracts and validation for
review evidence: requests, findings, dispositions, threads, checks, decisions,
and exact-head freshness. Its root export remains vendor-neutral. Meaningful
GitHub evidence translation belongs at `@vespeneventures/review/github`; it
does not warrant a separate `review-github` or generic `github` package.

`@vespeneventures/gates` remains the orchestration package for catalog and
policy checks. It is a separate foundation cluster, not a runtime dependency
of `repository` or `review`, and neither package becomes a general gate runner.

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

## Adoption and deprecation

The new package starts at `0.1.0` and runs in parallel with existing tooling.
A consumer adopts it by authoring its own profile and validating that profile
in the consumer's existing check path. No prior package is deprecated merely
because a Foundry contract now exists.

The paired registry-install and CLI qualification procedure is documented in
[REPOSITORY-REVIEW-FIRST-RUN.md](REPOSITORY-REVIEW-FIRST-RUN.md). It stops
before consumer workflow wiring, provider credentials, and consumer policy
decisions.

Deprecation is a later, owner-controlled step. It requires a published
successor, migrated real consumers, a documented replacement range, and a
settled public API. Package deletion, transfer, and registry deprecation are
not part of this phase.
