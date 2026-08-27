# Repository and review first run

This runbook qualifies the repository and review subpaths of one exact
`@vespeneventures/controller` artifact in designated consumer repositories.
It is deliberately a handoff guide, not an installer:
Foundry provides contracts and CLIs; each consumer authors and owns its own
values, workflow, and provider access.

The target result is evidence that the same published package versions can be
installed and exercised independently in each designated consumer. It is not a
claim that Foundry has installed a workflow, selected branch protection, or
approved a change for any consumer.

## Before the first consumer

1. Complete a full package preflight for Controller as specified in
   [PUBLISHING.md](PUBLISHING.md). The package tree and packed tarball must
   both pass a FULL public-safety scan, name-collision check, build, tests, and
   isolated-install proof.
2. Run the publication workflow in dry-run mode and inspect its package
   contents. Controller has no first-party runtime dependency; its repository
   and review subpaths ship from the same exact Controller artifact reviewed
   at the source head.
3. Record the published Controller version, source head, package tarball digest
   if the publication system reports one, and the successful preflight and
   workflow URLs in the Foundry release record.
4. Do not start consumer adoption from an unpublished workspace link, a local
   tarball, or a source checkout. The point of this run is to prove the
   registry artifact a consumer will actually receive.

The repository and review contracts are subpaths of Controller. Consumers
install one exact Controller artifact; no first-party runtime sibling or
legacy standalone package is required.

## Consumer installation

Each consumer first configures its own authenticated GitHub Packages access as
described in the repository root [README](../README.md#installing). The token
remains in that consumer's local or CI environment; it is never committed to
Foundry or recorded in an evidence bundle.

Install the exact Controller version, rather than a floating range, for the
first run:

```bash
npm install --save-exact @vespeneventures/controller@0.8.19
```

Use the package manager that owns the consumer's lockfile. The command above
shows only the required package names and version pinning; it does not impose a
workspace layout, lockfile tool, or registry-authentication mechanism.

## Consumer-owned inputs

Before running either CLI, a consumer authors these values in its own change:

- A repository profile JSON file for `repository-check`. It chooses its own
  default branch, verification commands, protected-path patterns, and v2
  upward requirements. If an account workspace evaluates those requirements,
  it separately owns discovery, declaration source identities, observations,
  precedence, and any resulting machine action.
- A review policy JSON file for `review-check`. It chooses its own required
  check names and whether an approval is required.
- A review evidence JSON file for `review-check`. It names the exact proposed
  change head, the complete check/review/thread snapshot, and whether
  pagination is complete.

For GitHub, a consumer may use `@vespeneventures/controller/review/github` in its own
code to normalize a fully fetched caller-provided snapshot before writing its
own evidence JSON. The subpath makes no request, does not discover credentials,
and does not choose pagination or workflow behavior. Provider tokens, raw
responses, account identities, and browser/session data stay out of Foundry.

## CLI smoke test

Run both commands from the consumer checkout, against consumer-owned files.
`repository-check` locates a declaration on its own (issue #315) — run it
with no argument (searches the current working directory), a repository root
directory, or an explicit file path, same as below:

```bash
npx --no-install repository-check                              # searches the current directory for governance/repository-profile.json
npx --no-install review-check path/to/review-evidence.json path/to/review-policy.json
```

Both commands emit one deterministic JSON report. Exit code `0` means the
input satisfied the package contract; `1` means the input was read but has
validation findings; `2` means the CLI could not run because arguments or JSON
input were invalid. A first run is not qualified by a synthetic success alone:
the review evidence must describe the adoption change's exact current head and
must have `paginationComplete: true`.

The review validator fails closed for incomplete pagination, stale or
mismatched-head evidence, missing or unsuccessful required checks, an absent
required approval, current change requests, and unresolved current threads.
Dismissed decisions remain visible evidence but do not request changes or count
as approvals.

## Evidence record

For each designated consumer, record only the following non-secret facts in
that consumer's adoption issue or pull request:

| Record | Required evidence |
| --- | --- |
| Artifact | Exact installed Controller version and lockfile update. |
| Change identity | Adoption pull request URL and exact tested head identifier. |
| Repository contract | Path to the consumer-owned profile and `repository-check` exit code/report. |
| Requirements evaluation | When used, the pure evaluator report for caller-discovered declarations and normalized observations; unknown evidence must remain explicit. |
| Review contract | Paths to the consumer-owned evidence and policy, plus `review-check` exit code/report. |
| Determinism | A repeated invocation on the unchanged inputs produces the same report. |
| CI | The consumer's existing deterministic checks pass at the exact tested head. |

Do not attach credentials, cookies, OAuth/session state, raw provider payloads,
or personal account and routing details to this record. If a consumer's own
profile or evidence file contains project-sensitive values, keep its contents
in that consumer repository rather than copying them here.

## Three-consumer qualification

Run the installation and smoke-test sequence independently for all three
designated consumers, using the same exact Controller version. Consumer-specific
workflow YAML, protected paths, commands, review-policy values, branch/ruleset
decisions, and provider invocation remain local to each consumer.

The Controller artifact's repository and review subpaths are ready for
promotion only when all three records show a successful registry install,
exact-head clean CLI reports, repeatable output, and passing consumer CI. A
provider-specific review subpath is not implied by these runs;
it needs separate evidence of meaningful reusable provider behavior.
