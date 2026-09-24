# CI conventions

This document is the MECE rule set every repository that runs CI on GitHub
Actions adopts: minimize cost, maximize speed, hold quality, and hold
security — the four concerns below, each exhaustive within itself and
disjoint from the others. Every rule names its reason and, where one exists,
the measurement that produced it. `ci-conventions-check` (`@clossys/
controller/conventions`) is the pure evaluator for this rule set; see its
own module doc for the input shape and the shared output envelope it emits.

Runner selection by repository visibility is its own document,
`runner-conventions.md`, because it is a decision keyed on one fact
(visibility) with its own pricing data file — this document references it
rather than repeating it under **Cost**.

**Cost** through **Security** are the MECE four; **Weekly Sunday `@clossys/*`
adoption**, at the end, is a fifth, orthogonal axis — cadence for a
consuming repository's own dependency updates on `@clossys/*` specifically,
not a fifth way to slice cost/speed/quality/security. It does not apply to
this repository, which produces `@clossys/*` rather than consuming it.

## Cost

- **Public repositories run on GitHub-hosted runners, which are free.**
  Extends `runner-conventions.md`'s `publicRepos` exemption: a public
  repository moving any job onto a paid provider creates spend where none
  existed. See `runner-conventions.md` for the full decision rule and its
  dated pricing data.
- **Paid runners only with a declared justification per job.** A blanket
  migration to a paid provider tier defaults every job to the higher-capacity
  (and therefore more expensive) label, including single-purpose scripts
  that gain nothing from extra cores. `runner-conventions.md`'s
  `highCapacityJustifiedJobs` is that declared justification, job by job.
- **`timeout-minutes` on every job.** A hung job with no timeout holds a
  runner slot for up to GitHub's own 6-hour ceiling, burning minutes on
  work that already failed to converge. One retrospective measurement
  (issue #1259) found 6 of 42 jobs in this repository's own CI declared
  one.
- **`concurrency` with `cancel-in-progress: true` on PR-triggered
  workflows, but never on `main`, release, or publish workflows.**
  Cancelling an in-progress PR run on a new push is a pure cost win — the
  superseded commit will never merge. Cancelling an in-progress run on
  `main` (or a release/publish workflow) is not: two close-together merges
  can leave the first `main` commit's run cancelled by the second, so that
  commit is never actually verified. The same retrospective found this
  exact shape in this repository's own `ci.yml`: `concurrency:
  ci-${{ github.ref }}` with `cancel-in-progress: true` applies to `push`
  runs on `main` as well as `pull_request` runs, because the group key does
  not distinguish them.
- **Minimal artifact `retention-days`.** GitHub's default artifact
  retention is 90 days; most CI artifacts (build output, test reports) are
  only useful for the lifetime of the run that produced them or the review
  that follows it. A public repository on the Free plan gets only 500 MB of
  artifact storage — an un-set `retention-days` is spending that budget on
  artifacts nobody will read again.
- **Scheduled workflows declare a cadence justification.** A `schedule:`
  trigger runs on every scheduled tick whether or not anything changed,
  unlike `pull_request`/`push`, which run only when there is a reason to.
  The justification is what lets a reviewer tell a cadence that still earns
  its cost from one nobody has revisited since it was set.
- **No duplicate `push` plus `pull_request` runs for the same commit.** A
  workflow triggered on both `push` and `pull_request` runs twice for an
  ordinary PR commit — once as the PR's head, once (if the same branch also
  triggers `push`) as a push — doubling the minutes spent for no additional
  coverage. Trigger on the pair that actually needs distinct behavior
  (`pull_request` for PR-only jobs, `push: branches: [main]` for
  post-merge-only jobs), never both for the same job.
- **A declared monthly minutes budget for private repositories.** Public
  repositories have no minutes budget to declare, because GitHub-hosted
  minutes on them are free and unlimited (rule one, above). A private
  repository's declared budget is what `ci-conventions-check` compares a
  projected minutes figure against, when run history is supplied.

## Speed

- **A merge queue instead of the strict up-to-date rule.** The strict
  "must be up to date with the base branch before merging" rule forces a
  serial rebase-and-recheck for every merge once more than one PR is ready,
  which is exactly the shape that makes landing PRs one at a time
  prohibitive at any real merge rate. A merge queue (GitHub's own
  `merge_group` trigger) batches and verifies candidates instead.
- **Parallel jobs behind a fan-in that keeps the required context name.**
  Splitting one long serial job into parallel jobs only pays off if the
  repository's required-status-check context still exists under its
  original name afterward — otherwise every consuming ruleset needs an
  edit at the same moment the workflow does. A fan-in job with `needs:` on
  every split job, reporting under the original context name, is what
  keeps the two changes independent. See **Quality**, below, for why that
  fan-in job's own condition matters as much as its name.
- **Long serial steps sharded with a matrix bounded by the plan's
  concurrent-job limit.** A matrix with more shards than the plan's
  concurrent-job ceiling does not run any faster than one sized to the
  ceiling — the excess shards simply queue — so the matrix size is a
  declared fact about the plan, not a free parameter.
- **Dependency and build caching.** `actions/setup-node`'s built-in
  `cache:` input (or an explicit `actions/cache` step) turns a full
  dependency install into a cache hit on every run whose lockfile has not
  changed. This repository's own retrospective (#1259) found caching
  already present in 11 places — the convention is to keep it there and add
  it wherever a new job installs dependencies or produces build output
  another job in the same run consumes.
- **Affected-only tests on PRs, with the full suite in `merge_group`.** A
  PR only needs proof that what it touched still works; the merge queue's
  `merge_group` run is what has to prove the whole tree still holds
  together before the merge actually lands. Running the full suite on
  every PR commit spends the same minutes twice for no additional
  confidence at the PR stage.
- **Review in parallel with CI**, not gated behind it. A reviewer reading a
  diff does not need CI to have finished first — serializing review behind
  CI is dead time on the human side of the loop that buys nothing.
- **Tests that clean up their temp dirs, with disk budgets (#1250).** A
  test suite that leaks temporary directories degrades every later run
  sharing the same runner disk, up to and including running the runner out
  of space entirely. This repository's own `packed-consumer-readiness` job
  was measured writing 4–7 GB per run before its cleanup was fixed — the
  exact failure mode #1250 exists to prevent from recurring.

## Quality

- **Every required context runs on both `pull_request` and `merge_group`.**
  A merge queue (see **Speed**) only protects `main` if the same checks
  that ran on the PR also run on the batched `merge_group` commit — a
  context declared required but wired only to `pull_request` silently stops
  gating the moment the repository adopts a merge queue.
- **A required workflow is never path-filtered at the trigger.** GitHub
  treats a workflow that a trigger's `paths`/`paths-ignore` filter skipped
  the same as one that never ran at all for that commit — and a skipped
  required check reports as **passing**, not as absent. A PR that touches
  only excluded paths would merge with a required context that never
  actually evaluated it. Use a job-level skip (an early `if:` condition
  inside the job) plus a fan-in that reports success instead — see the next
  rule for what that fan-in itself must do to stay honest.
- **The fan-in uses `if: always()` and an explicit results check.**
  GitHub's own default for any job that `needs:` other jobs is to skip
  unless every needed job succeeded — which means an ordinary fan-in job,
  with no `if:` of its own, is skipped the moment one of the jobs it fans
  in from fails, and a skipped required check still reports as passing.
  `if: always()` disables that implicit gate; the fan-in job must then
  check each needed job's `result` explicitly and fail itself on anything
  other than `success` (a `failure`, a `skipped`, or a `cancelled` result
  all count as the fan-in failing). This repository's own `ci.yml` (`build`
  job, landed in #1240) is the worked example this rule generalizes from —
  see that job's own step-level comment for the full reasoning.
- **Required contexts are declared in the repository profile and
  reconciled with the ruleset.** A required-status-check context that
  exists in the branch-protection ruleset but not in the repository's own
  declared profile (or vice versa) is drift the same shape as every other
  live-state surface this package already reconciles (see
  `live-state-reconciliation.md`) — neither side is allowed to be silently
  assumed correct.
- **Status captures are bracketed by `set +e` / `set -e`.** A shell step
  that captures a command's exit status with `status=$?` after a command
  the workflow does not want to fail the step outright needs `set +e`
  before that command and `set -e` immediately after capturing the status —
  otherwise the shell's default `errexit`-off behavior (or a stray
  `set -e` left active from an earlier step) can make the capture itself
  unreliable, either failing the step before the status is read or letting
  a later real failure go unnoticed because `errexit` was never restored.
- **Gate names follow `gate-naming.md`.** A required-status-check context
  is a gate name like any other this package governs, and the same
  `<verb>-<noun>[-<noun>]` grammar and `validateGateName` apply to it. This
  repository's own retrospective (#1259) found 15 of its 16 required
  contexts predate that grammar and do not conform (for example `build and
  test`, `publish safety`, `scope drift`, `registry drift`) — see the
  rename sequence recorded on that issue for how a repository renames a
  required context without a window where the ruleset requires a name
  nothing publishes.

## Security

- **Least-privilege `permissions:`, defaulting to read.** A workflow with
  no top-level `permissions:` block inherits the repository's (or
  organization's) default token permissions, which is frequently broader
  than any job in the workflow actually needs. Declaring `permissions:
  contents: read` (or narrower) at the top level, with any job that needs
  more declaring exactly that job-level exception, bounds what a compromised
  step or a malicious transitive action dependency can do with the token.
- **Third-party actions pinned by full commit SHA.** A tag or branch
  reference (`actions/checkout@v4`, `actions/checkout@main`) can be
  repointed by the action's own maintainer — or, if their account is
  compromised, by an attacker — to a different commit without the pin in
  this repository's workflow file ever changing. A full 40-character commit
  SHA is the only reference GitHub cannot silently repoint. This
  repository's own retrospective (#1259)
  found 99 of 99 third-party `uses:` already pinned this way — the
  convention exists to keep every future repository, and every new action
  this repository adopts, at that same standard from the start.
- **OIDC (trusted publishing, cloud federation) over long-lived secrets.**
  A long-lived secret sits in the repository's or organization's secret
  store indefinitely, readable by anything with `secrets` access and valid
  until manually rotated. An OIDC-issued token is scoped to one workflow
  run and expires with it, which is a strictly smaller blast radius for the
  same access.
- **No secrets in logs.** A secret interpolated into a `run:` step's shell
  command, or into an `echo`, appears in that step's log in plain text
  regardless of whether GitHub's own log-masking catches the exact string —
  masking is a safety net for accidental exposure, not a reason to rely on
  it deliberately. Pass secrets through `env:` and reference them as
  `$VAR`, never inline them into the command text itself.
- **Shared mechanics consumed as reusable workflows (#257), not vendored
  copies.** A workflow step sequence copied into more than one repository
  drifts the moment either copy is fixed without the other — the same
  problem this package exists to solve for every other convention it
  governs. A reusable workflow (`uses: owner/repo/.github/workflows/
  x.yml@<sha>`) is the one copy; every consumer calls it rather than
  pasting its steps.

## Weekly Sunday `@clossys/*` adoption (consuming repositories)

This section applies only to a **consuming repository** — one that installs
one or more `@clossys/*` packages — never to this repository itself, which
produces them. Owner direction (2026-09-23, #1187/#1259's own cadence rule):
this repository's own packages release on a **weekly Saturday wave**; a
consuming repository adopts the new versions the **following Sunday**, and
every Monday starts fresh. `evaluateWeeklyAdoption`
(`@clossys/controller/conventions`, delegated to from `evaluateCiConventions`
via `CiConventionsDeclaration.weeklyAdoption`) is the pure evaluator for the
four rules below — see its own module doc for the input shape. A repository
that does not consume `@clossys/*` at all (this one included) omits
`weeklyAdoption` from its declaration entirely, or declares `applies:
false`; every rule is then skipped as not applicable, never reported as a
gap.

1. **`@clossys/*` dependency updates are grouped into exactly one pull
   request per repository per week, scheduled for Sunday in the
   repository's declared timezone, through whichever updater the repository
   already runs.** One grouped PR is one thing to review and merge — the
   opposite of a stream of one-package-at-a-time bumps arriving on no
   predictable day, which is what an ungrouped or unscheduled updater
   produces by default. "The repository's declared timezone" matters
   because "Sunday" is not a well-defined instant without one: a repository
   in `Pacific/Auckland` and one in `America/Los_Angeles` are never in
   Sunday at the same moment.

   **Renovate** (minimal `.github/renovate.json`):

   ```json
   {
     "packageRules": [
       {
         "matchPackagePatterns": ["^@clossys/"],
         "groupName": "clossys weekly",
         "schedule": ["on sunday"]
       }
     ]
   }
   ```

   **Dependabot** (minimal `.github/dependabot.yml` -- an illustrative
   repo-relative path a consuming repository's own tree would have; that
   path does not ship with this package):

   ```yaml
   version: 2
   updates:
     - package-ecosystem: "npm"
       directory: "/"
       schedule:
         interval: "weekly"
         day: "sunday"
       groups:
         clossys:
           patterns:
             - "@clossys/*"
   ```

   `evaluateWeeklyAdoption` reads whichever config the repository already
   has (never both) and reports `ci/weekly-adoption-grouped-schedule` as
   `satisfied`, `missing` (no matching group exists at all), or `violated`
   (a matching group exists but is ungrouped, or scheduled for a day other
   than Sunday, or — Dependabot only — scheduled at an interval other than
   `weekly`).

2. **A security advisory for `@clossys/*` bypasses the schedule and applies
   immediately.** A grouped weekly schedule is right for an ordinary
   version bump; it is wrong for a fix to a vulnerability already disclosed
   and exploitable, where every day of delay is a day the consuming
   repository runs known-vulnerable code on purpose. Renovate applies
   `vulnerabilityAlerts` immediately by default — `ci/weekly-adoption-
   security-bypass` is `violated` only if `vulnerabilityAlerts.schedule` is
   explicitly set to something that is not `["at any time"]`, i.e. the
   repository has overridden the safe default into an unsafe one.
   Dependabot security updates are a separate, repository-level setting
   from `dependabot.yml`'s version-update schedule and always apply
   immediately regardless of what this file declares, so this rule is
   `satisfied` unconditionally for a Dependabot-configured repository.

3. **No other automation bumps a `@clossys/*` range on any other day.** A
   second, independent Renovate `packageRules` entry or Dependabot
   `updates` entry that also matches `@clossys/*` packages — deliberately
   or by an overly broad ecosystem match — reintroduces exactly the
   unpredictable, un-grouped updates rule 1 exists to remove, even while
   rule 1's own group is configured correctly. `ci/weekly-adoption-no-
   other-automation` is `violated` when more than one Renovate rule matches
   `@clossys/*`, or when a Dependabot `npm`-ecosystem `updates` entry other
   than the grouped one neither groups nor `ignore`s `@clossys/*`.

4. **The adoption pull request runs the repository's normal required
   checks, plus `integrator-provenance-check` (#885/#1169), before it
   merges.** The grouped PR still changes what the repository actually
   runs, so it earns the same required-status-check gate every other
   change does; `integrator-provenance-check` additionally verifies the
   installed `@clossys/*` packages' registry provenance and currency,
   which a plain version-range diff cannot. Most consuming repositories
   name this required context `integrator-provenance-check` directly, after
   the installed CLI itself — a narrow, deliberate exception to
   `gate-naming.md`'s "a scanning tool's own name is not the gate that runs
   it" rule, made because this is a shared, cross-repository identifier
   every consumer recognizes on sight, not a repository's own authored
   check. A repository that instead wraps the tool behind a conformant gate
   name declares that name via `WeeklyAdoptionDeclaration
   .provenanceCheckContext`. `ci/weekly-adoption-provenance-check-required`
   is `missing` when that context is absent from the adoption PR's required
   contexts.
