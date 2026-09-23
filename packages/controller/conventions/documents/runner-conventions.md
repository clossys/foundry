# Runner-Label Conventions

This document defines the conventions for declaring and validating CI runner labels
across repositories that have adopted a third-party CI compute provider.

## Problem Statement

When repositories adopt a third-party CI provider by changing `runs-on:`
labels from the default GitHub-hosted labels to provider-specific labels, the
same drift problems appear that this package already addresses for branch names,
skill names, gate names, and routine declarations:

1. **Capacity defaults, not decisions** — a blanket migration often places every job
   on the higher-capacity (more expensive) tier, including single-purpose scripts where
   extra cores provide no benefit.
2. **No drift detection** — a repository silently reverting a `runs-on:` line,
   or a new repository never adopting the convention, surfaces only as a
   surprise on the next invoice.
3. **Visibility mismatch** — a public repository already gets GitHub-hosted
   minutes free. Moving it to a paid provider creates spend where none existed
   before, yet nothing prevents a future PR from adopting the provider onto it.

## Convention

### Declaration

Each declaring context declares a **RunnerVocabulary** and a **visibility exemption list**:

```json
{
  "runnerVocabulary": {
    "labels": [
      { "label": "blacksmith-2vcpu-ubuntu-2204", "capacity": "standard", "intendedWorkload": "default" },
      { "label": "blacksmith-4vcpu-ubuntu-2204", "capacity": "high", "intendedWorkload": "build+test" }
    ],
    "defaultLabel": "blacksmith-2vcpu-ubuntu-2204",
    "highCapacityJustifiedJobs": ["frontend-verify", "node-tests-verify", "site-verify", "admin-verify"]
  },
  "publicRepos": ["foundry"]
}
```

### Fields

- **labels** — the approved label vocabulary. Each entry specifies the exact
  label string, its capacity tier (`standard` or `high`), and the intended workload
  shape (documentary only).
- **defaultLabel** — the label that should be used for jobs without an explicit
  justification for a different tier.
- **highCapacityJustifiedJobs** — an explicit list of job names (as they appear in
  workflow YAML) that are pre-approved for the high-capacity tier. Any job using a
  high-capacity label not in this list is a violation.
- **publicRepos** — repositories that are public and therefore MUST use
  GitHub-hosted runners (free). A job in a public repo using a paid-provider
  label is a violation unless the repo is explicitly listed here as an
  intentional exception.

### Consumer Repository Responsibility

Each repository wires the pure evaluator (exported from
`@example/conventions/runner`) into its own CI. The evaluator takes the
declared conventions plus the repository's parsed workflow job definitions and
returns one of three states per job:

- **satisfied** — label is in the vocabulary; if repo is public, it's exempted.
- **violated** — label unknown, high capacity unjustified, or public repo on paid provider.
- **indeterminate** — no vocabulary declared, or workflow files unparsable. **Never
  silently resolves to `satisfied`**.

### Evaluation Rules

1. Missing vocabulary → `indeterminate` for all jobs.
2. Label not in vocabulary → `violated`.
3. Public repo + paid-provider label → `violated` (unless repo in `publicRepos`).
4. High-capacity label + job not in `highCapacityJustifiedJobs` → `violated`.
5. Otherwise → `satisfied`.

### Drift Detection

A scheduled run of the evaluator against each repository's current workflow
files turns "surprise on next invoice" into a filed finding before the invoice
arrives. The declaring context owns the schedule; the consumer repository owns
the wiring.

## Runner stack by repository visibility (issue #1259)

The vocabulary above (labels, `defaultLabel`, `highCapacityJustifiedJobs`,
`publicRepos`) governs which label a job may use. This section is the prior
decision — which provider a repository defaults to in the first place —
that the vocabulary is then declared against. Prices referenced below
change; they live as dated data in `conventions/data/runner-pricing.json`
(`asOf`, source URLs), read by `ci-conventions-check`'s evaluator, and are
never hard-coded here or in code.

### Decision rule

1. **Public repositories use GitHub-hosted standard runners, always.**
   They are free and unlimited (`runner-pricing.json`'s
   `githubHosted.publicRepos`). No paid provider — adopting one creates
   spend where there was none. No self-hosted runner — a fork PR would
   execute untrusted code on that hardware. A larger GitHub-hosted runner
   is paid even on a public repository, so it still needs a justified
   `highCapacityJustifiedJobs` entry.
2. **Private repositories default to Blacksmith, 2 vCPU** (`blacksmith-
   2vcpu-ubuntu-2204`), on its ARM variant where the toolchain supports it
   and x64 otherwise. It is cheaper per minute than GitHub-hosted
   (`runner-pricing.json`'s `blacksmith.costPerMinute`) on faster hardware,
   and its 3,000 free minutes/month stack **on top of** GitHub's own
   included minutes — a Free-plan account gets roughly 5,000 free Linux
   minutes/month between the two. GitHub-hosted remains the fallback for
   any job that needs a GitHub-only runner feature. Higher-vCPU tiers are
   `highCapacityJustifiedJobs` only, same as the base vocabulary above.
3. **Self-hosted runners** are permitted only in a private repository with
   no fork PRs, only with a declared justification, and only with a
   custody entry for the runner in Locksmith (#1212).
4. **Every private repository declares spend guardrails:** the account's
   GitHub Actions spending limit left at $0 unless deliberately raised (so
   overage fails closed rather than billing silently), a declared monthly
   minutes budget, and every cost lever `ci-conventions.md`'s **Cost**
   section already makes mandatory (PR-only `cancel-in-progress`,
   affected-only PR tests, caching, `timeout-minutes`, short
   `retention-days`) — the Free plan's 500 MB artifact allowance in
   particular leaves no room for a long `retention-days` default.
5. **Security for a third-party runner provider:** its GitHub App holds
   repository access and runs jobs with that repository's secrets, so
   prefer OIDC over stored secrets, declare each secret's custody (#1212),
   and never grant the provider app access to a public repository — rule 1
   already keeps a public repository off it entirely.

### What `ci-conventions-check` evaluates for this section

- Visibility against runner label: a paid-provider label on a public repo
  is a violation (already covered by `runner/visibility-mismatch` above); a
  GitHub-hosted label on a private repo whose projected spend exceeds its
  declared budget is a warning, not a violation — GitHub-hosted remains a
  legitimate fallback, so this is a cost signal, not a rule break.
- Label tier against `highCapacityJustifiedJobs`, exactly as `runner/
  unjustified-capacity` already does.
- Presence of each declared cost lever from `ci-conventions.md`.
- A projected monthly minutes figure, when the caller supplies run
  history: the projection is compared against `runner-pricing.json`'s free
  allowances plus the declared monthly budget, with a warning when it
  exceeds either. No run history supplied means this check is skipped, not
  reported as a violation or as indeterminate — a projection nobody
  supplied is simply absent, not evidence of anything.

## Non-Goals

- Provider subscription status, capacity, per-project cache/concurrency limits,
  per-minute pricing — these live in the provider's dashboard and GitHub's org
  Actions settings, not in repository content.
- The evaluator's `indeterminate` state represents this gap honestly rather
  than guessing.