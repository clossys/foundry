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

## Non-Goals

- Provider subscription status, capacity, per-project cache/concurrency limits,
  per-minute pricing — these live in the provider's dashboard and GitHub's org
  Actions settings, not in repository content.
- The evaluator's `indeterminate` state represents this gap honestly rather
  than guessing.