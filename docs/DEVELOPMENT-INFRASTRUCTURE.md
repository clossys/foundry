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

`@vespeneventures/repository` is the first package. It owns a provider-neutral
contract for consumer-authored repository values and validates those values
without I/O. It does not install files or choose values for a consumer.

`@vespeneventures/gates` remains the orchestration package for catalog and
policy checks. New repository infrastructure must reuse it instead of creating
a second generic gate runner.

The following names are deliberately deferred:

- `@vespeneventures/review`: add only after a reusable review contract and a
  proving consumer exist.
- `@vespeneventures/github`: add only when real GitHub-specific behavior is
  extracted behind vendor-neutral contracts; workflow YAML remains local.
- Provider review adapters: add a dedicated adapter only when it performs
  meaningful provider-specific translation, invocation, or evidence parsing.
  A package that merely re-exports a review type is not sufficient.

This avoids both a monolithic development package and a family of empty
provider wrappers.

## Adoption and deprecation

The new package starts at `0.1.0` and runs in parallel with existing tooling.
A consumer adopts it by authoring its own profile and validating that profile
in the consumer's existing check path. No prior package is deprecated merely
because a Foundry contract now exists.

Deprecation is a later, owner-controlled step. It requires a published
successor, migrated real consumers, a documented replacement range, and a
settled public API. Package deletion, transfer, and registry deprecation are
not part of this phase.
