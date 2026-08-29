# The thin caller workflow

This document is the consumer-side half of the gate. The package holds the
grammar and the decisions; a consuming repository holds the values, the
credentials, and the collection. This is what that repository adds.

Nothing here is a value this package endorses. Every name, label, path, and
requirement below is a placeholder for something the consuming repository
chooses. Replace them.

---

## Why the collection lives in the caller, not in the package

Every check in this package is a pure function of observations someone else
gathered. That is not an aesthetic preference; three concrete properties fall
out of it, and each one was a real defect in an earlier design:

1. **The package needs no credential of its own.** A scanner token, a tracker
   token, an administration-scoped token — none of them cross the package
   boundary, because the package never calls anything. A shared gate that
   wants credentials is a shared gate every consumer must trust with them.
2. **The verdict is auditable.** The inputs document is a file. It can be
   uploaded as a run artifact, diffed, and re-fed to the CLI offline to
   reproduce a verdict exactly. A gate that both collects and decides leaves
   nothing behind to re-examine when its answer is disputed.
3. **"The tool did not run" survives.** A step that collects can report that
   it failed to collect. A step that collects *and* decides has, by the time
   it decides, lost the distinction between "nothing was found" and "nothing
   was looked for" — which is the failure this whole package exists to
   prevent.

---

## The workflow

Two jobs' worth of work, usually one job. Collect, then decide.

```yaml
name: Verify standards

# No `paths:` filter, on purpose. This is meant to be a required,
# unconditional status check. A path filter means a change that happens to
# land outside a guessed scope silently never runs it, and a required check
# that never ran is a required check that never failed.
on:
  pull_request:
    # `edited` is NOT in the default set (`opened`, `synchronize`,
    # `reopened`) and is not optional here. The task-record check reads the
    # pull request DESCRIPTION, so editing the description edits this gate's
    # own evidence: a change can pass with a work-item reference in its body
    # and then have that reference quietly deleted, with nothing left to
    # re-evaluate it. Re-running the job does not close this — a re-run
    # replays the ORIGINAL event payload, so it reads the old description
    # and cheerfully passes again. Only a fresh `edited` event delivers the
    # current text. Any consumer whose inputs document is assembled from
    # editable conversation text needs this line.
    types: [opened, synchronize, reopened, edited]

permissions:
  contents: read
  pull-requests: read
  issues: read

concurrency:
  group: inspector-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # The job id and the job name match, so the required-status-check context
  # string stays stable when the display name is edited.
  inspector:
    name: inspector
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@<PIN_A_FULL_COMMIT_SHA>
        with:
          # A history scan needs history. A shallow clone silently reduces
          # what any scanner can see, which reads exactly like a clean result.
          fetch-depth: 0

      - uses: actions/setup-node@<PIN_A_FULL_COMMIT_SHA>
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
          # Required, and not a formality. With `scope` omitted, this action
          # maps the *consuming repository's own owner* to the registry above,
          # so a consumer in any other account routes this package to the
          # public registry instead and the install fails to resolve it.
          scope: "@clossys"

      # Installed from this repository's own lockfile, like every other
      # dependency, so the resolved version is reviewable in a diff and swept
      # by whatever dependency-freshness process this repository already runs.
      #
      # `--ignore-scripts` because this step is the one place a registry
      # token is in the environment: a dependency lifecycle script inherits
      # that environment and can read the token out of it. This package needs
      # no install script of its own. A repository whose other dependencies
      # do should run those in a separate step, after the token is out of
      # scope, rather than widen this one.
      - run: npm ci --ignore-scripts
        env:
          NODE_AUTH_TOKEN: ${{ secrets.PACKAGES_READ_TOKEN }}

      # ---- COLLECT -------------------------------------------------------
      # Each collection step is `continue-on-error` and records its own
      # outcome as data. A step that dies must produce a record saying it
      # died, never an absent record that reads as a clean one.

      - name: Run the secret scanner
        id: scan
        continue-on-error: true
        run: ./.github/scripts/collect-secret-scan.sh > scan.json

      - name: Collect review evidence
        id: review
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
        run: ./.github/scripts/collect-review-evidence.sh > review.json

      - name: Assemble the inputs document
        env:
          # Untrusted pull-request text goes through `env:`, never through
          # string interpolation into a `run:` body.
          PR_BODY: ${{ github.event.pull_request.body }}
          PR_AUTHOR: ${{ github.event.pull_request.user.login }}
          PR_HEAD_REF: ${{ github.event.pull_request.head.ref }}
          PR_LABELS: ${{ toJSON(github.event.pull_request.labels.*.name) }}
          SCAN_OUTCOME: ${{ steps.scan.outcome }}
          REVIEW_OUTCOME: ${{ steps.review.outcome }}
        run: ./.github/scripts/assemble-inputs.mjs > verify-inputs.json

      # ---- DECIDE --------------------------------------------------------
      # One command, no credentials, no network. Its exit code is the job's —
      # and the block below exists to keep that sentence literally true.

      - name: inspector
        run: |
          # DO NOT pipe the CLI into `tee`. GitHub Actions runs a `run:` block
          # as `bash -e {0}`: `-e` is set, `-o pipefail` is NOT. A pipeline's
          # exit status is its LAST command's, so `inspector ... | tee`
          # reports tee's `0` and throws the verdict away — a `violated` (1)
          # or `indeterminate` (2) run renders "Overall: VIOLATED" into the
          # job summary while the step itself goes green. That is not a
          # hypothetical: this template shipped with that pipe and two
          # consuming repositories ran green against a violated verdict.
          #
          # Two independent guards, because a gate that computes the right
          # answer and then discards it is the exact defect this package
          # exists to eliminate:
          #   1. `set -o pipefail` restores a pipeline's real status for
          #      anything added to this step later.
          #   2. The decisive command is in no pipeline at all. It writes to
          #      a file, its status is captured explicitly, the summary is
          #      appended afterwards, and the step ends by re-raising that
          #      status. So an editor who deletes guard 1 has not silently
          #      re-opened the hole.
          # `exit "$status"` is load-bearing: without it the step's status is
          # the last `cat`'s, which is always 0.
          set -o pipefail
          report="$RUNNER_TEMP/inspector-report.txt"
          status=0
          npx inspector \
            --inputs verify-inputs.json \
            --declared-range "$(node -p "require('./package.json').devDependencies['@clossys/inspector']")" \
            > "$report" || status=$?
          cat "$report"
          cat "$report" >> "$GITHUB_STEP_SUMMARY"
          exit "$status"

      # Keeping the inputs is what makes a disputed verdict re-checkable
      # later, offline, without re-running any collection.
      - uses: actions/upload-artifact@<PIN_A_FULL_COMMIT_SHA>
        if: always()
        with:
          name: inspector-inputs
          path: verify-inputs.json
```

### What this workflow trusts, and what it does not

The gate decides nothing about a repository it did not read from the inputs
document. That is the property the whole design is built on, and it has a
consequence the template above must state rather than imply: **the verdict is
exactly as trustworthy as the revision that produced the inputs document.**

Under `on: pull_request`, the workflow file, the collector scripts, and the
assembler all come from the pull request's own revision. A change that edits
`assemble-inputs.mjs` is a change that edits the evidence its own gate will
read. For a repository where opening a pull request already requires write
access, that is the same trust boundary the branch itself has, and reviewing
the diff is what closes it — the collectors are part of what a reviewer is
looking at, and a change to them should read as loudly as a change to the
gate. Two things follow, and neither is optional:

- **A change to `.github/scripts/` or to this workflow is a change to the
  gate.** Give those paths whatever review requirement the repository gives
  its most sensitive code. A gate whose evidence collection can be edited
  without a second reader is a gate with a documented bypass.
- **Do not hand a secret to a job that runs code from an untrusted
  revision.** `GH_TOKEN` above is `github.token` — for a fork pull request
  GitHub already reduces it to read-only and withholds every repository
  secret, which is the correct behaviour and not something to work around.
  Never reach for `pull_request_target` to restore them; that runs the
  base revision's *workflow* against the fork's *code* with full
  credentials, which is strictly worse than the problem it appears to fix.

**A repository that accepts pull requests from forks needs more than this
template.** Fork runs receive no `PACKAGES_READ_TOKEN`, so the install step
above cannot authenticate to a private registry and the job stops before the
gate runs. A stopped job is red rather than falsely green, so nothing is
laundered — but a required check that can never pass on a fork pull request
is a required check that blocks every fork contribution. Splitting trusted
installation and decision from untrusted collection is the shape that solves
it, and the split belongs to the consuming repository, whose fork policy and
credentials decide what it looks like. **"The fork-accepting shape" below is
that second worked example** — read it before adopting this template into
any repository that accepts pull requests from forks.

### On never piping the decision step

The gate's whole value is one number: the CLI's exit status. Anything that
sits between that number and the step's own status can lose it, and the
default shell loses it silently.

GitHub Actions invokes a `run:` block as `bash -e {0}`. `-e` is on;
`-o pipefail` is not, and cannot be turned on for the whole workflow from
`defaults.run` — `shell: bash` there gets `bash --noprofile --norc -eo pipefail`,
but only for steps that opt into it, which is one more thing to forget in one
more file. In a pipeline without `pipefail`, `$?` is the last command's
status. `inspector … | tee -a "$GITHUB_STEP_SUMMARY"` therefore reports
`tee`'s `0` no matter what the gate concluded, and a `1` or a `2` becomes a
green check with the real verdict printed, in full, in the job summary nobody
reads on a passing run.

Two rules follow, and the step above applies both:

- **Nothing that decides may be the left-hand side of a pipe.** Redirect to a
  file, capture the status, and re-raise it explicitly at the end of the step.
- **Set `pipefail` anyway**, for whatever a later edit adds to the same block.

The same trap applies to any collection step whose failure must be *recorded*
rather than ignored — but those steps are `continue-on-error` and write their
own outcome as data, so a lost status there is caught by the inputs document
instead. It is only the decision step where the status is the entire result.

### On `--declared-range`

Passing the range this repository declared for the package lets the running
build answer a question it could not otherwise reach: whether this
repository's *next* lockfile refresh could legitimately resolve a build the
current one already knows is unsafe. Without it, only the running build's own
version is checked, and a current build always clears its own floor. See the
package README's section on the staleness floor for why that gap exists and
what closes it.

### On what a `2` means

Exit `2` is not a softer `1`. It means some part of the run could not be
evaluated, so nothing about that part has been established in either
direction. There is deliberately no flag anywhere in this package that turns
a `2` into a `0`.

Whether a `2` blocks a merge is this repository's own branch-protection
decision, made in this repository. That is the one place such an exception
belongs: local, visible, and unable to affect anybody else's gate.

---

## The fork-accepting shape

Everything above is one job because it can afford to be: `on: pull_request`
already runs a fork's own workflow copy against a fork's own code, with no
repository secret in scope. The install step is what breaks that shape the
moment a repository accepts pull requests from forks — `PACKAGES_READ_TOKEN`
is a repository secret, GitHub withholds every repository secret from a fork
pull request's run, and there is no flag that changes that. The job stops at
`npm ci`, before the gate has run at all, and a required check that can never
pass on a fork pull request blocks every fork contribution outright.

`pull_request_target` looks like the fix and is not one: it runs the *base*
revision's workflow against the *fork's* code, with full repository secrets
in scope for that run. A job built on it that checks out the pull request's
head (as almost every use of it does, to actually test the change) is a
credentialed step executing untrusted code — worse than the gap it appears
to close, not a fix for it.

The shape that actually works splits the job in two, in two **separate
workflow files**, joined by an uploaded artifact:

- **`collect`** — still `on: pull_request`, still runs on the fork's own
  workflow copy against the fork's own code, still holds no secret. This is
  everything above, minus the install step and the decision: it gathers
  observations and uploads one JSON artifact. Nothing here needs to change
  about how untrustworthy this job's environment is, because nothing here
  gets a credential to protect.
- **`decide`** — triggered by `on: workflow_run`, referencing the `collect`
  workflow by name. A `workflow_run` job always executes with the
  **target** repository's own permissions and secrets, regardless of
  whether the run that triggered it came from a fork — that is what makes a
  credential available here at all. It never checks out, builds, or
  executes a single byte of the pull request's own code. Its only input
  from the untrusted run is one downloaded JSON artifact, and even that is
  not trusted as-is (see "Re-derive, do not believe" below).

```yaml
# .github/workflows/inspector-collect.yml — untrusted, holds no secret,
# runs on every pull request including one from a fork.
name: inspector (collect)

on:
  pull_request:
    types: [opened, synchronize, reopened, edited]

permissions:
  contents: read
  pull-requests: read
  issues: read

concurrency:
  group: inspector-collect-${{ github.ref }}
  cancel-in-progress: true

jobs:
  collect:
    name: collect
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<PIN_A_FULL_COMMIT_SHA>
        with:
          fetch-depth: 0

      # ---- COLLECT ---------------------------------------------------
      # Identical to the single-job template's collection steps: each one
      # is `continue-on-error` and records its own outcome as data.
      - name: Run the secret scanner
        id: scan
        continue-on-error: true
        run: ./.github/scripts/collect-secret-scan.sh > scan.json

      - name: Collect review evidence
        id: review
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
        run: ./.github/scripts/collect-review-evidence.sh > review.json

      - name: Assemble the inputs document
        env:
          PR_BODY: ${{ github.event.pull_request.body }}
          PR_AUTHOR: ${{ github.event.pull_request.user.login }}
          PR_HEAD_REF: ${{ github.event.pull_request.head.ref }}
          PR_LABELS: ${{ toJSON(github.event.pull_request.labels.*.name) }}
          SCAN_OUTCOME: ${{ steps.scan.outcome }}
          REVIEW_OUTCOME: ${{ steps.review.outcome }}
        run: ./.github/scripts/assemble-inputs.mjs > verify-inputs.json

      - uses: actions/upload-artifact@<PIN_A_FULL_COMMIT_SHA>
        with:
          name: inspector-inputs
          path: verify-inputs.json
```

```yaml
# .github/workflows/inspector-decide.yml — trusted, holds the real
# credential, and never checks out the pull request it is evaluating.
name: inspector (decide)

on:
  workflow_run:
    workflows: ["inspector (collect)"]
    types: [completed]

permissions:
  contents: read
  checks: write  # to post the required status check onto the pull request
  actions: read  # to re-read the triggering run and its artifacts

concurrency:
  group: inspector-decide-${{ github.event.workflow_run.id }}
  cancel-in-progress: false

jobs:
  decide:
    name: decide
    runs-on: ubuntu-latest
    steps:
      # This checkout is for installing the package and running the script
      # below, nothing else. It is always this repository's own default
      # branch — `workflow_run` resolves the WORKFLOW FILE from the default
      # branch unconditionally, the same way `pull_request_target` does (see
      # "Which known trap this shape avoids, and which it does not" below).
      # The pull request under evaluation is never checked out in this job.
      - uses: actions/checkout@<PIN_A_FULL_COMMIT_SHA>

      # ---- RE-DERIVE, DO NOT BELIEVE ----------------------------------
      # Three facts this job must establish independently before trusting
      # anything the collect run produced — none of them may come from the
      # artifact's own content, because an attacker's collect job is free
      # to write that content however it likes:
      #
      #   1. The collect run actually finished, and succeeded. A cancelled
      #      or failed collect run must never read as "nothing to flag."
      #   2. Which commit this is even about, and that the commit is real.
      #      `workflow_run.head_sha` and `workflow_run.head_repository.full_name`
      #      — populated for a fork run, never a field inside the uploaded
      #      JSON — name a commit; this step also LOOKS IT UP, confirming
      #      that SHA actually exists in the named repository, before
      #      anything below evaluates the artifact or a Check Run is
      #      created against it. (This requires the named repository to be
      #      public — the same assumption this whole section already makes
      #      for a fork pull request.) `workflow_run.pull_requests` is
      #      deliberately NOT used here: GitHub leaves that array empty for
      #      a pull request from a forked repository, which is exactly the
      #      case this workflow exists for.
      #   3. That the artifact downloaded below is the one THIS run
      #      produced — scoped by `run-id`, never resolved by matching on
      #      artifact name alone, which nothing stops a different run
      #      (including one on an unrelated PR) from reusing.
      - name: Verify the triggering run before trusting anything it produced
        id: run
        env:
          GH_TOKEN: ${{ github.token }}
          RUN_CONCLUSION: ${{ github.event.workflow_run.conclusion }}
          HEAD_SHA: ${{ github.event.workflow_run.head_sha }}
          HEAD_REPOSITORY: ${{ github.event.workflow_run.head_repository.full_name }}
        run: |
          set -euo pipefail
          if [ "$RUN_CONCLUSION" != "success" ]; then
            echo "::error title=Collect run did not succeed::conclusion was '$RUN_CONCLUSION' — refusing to evaluate its output."
            exit 1
          fi
          if [ -z "$HEAD_SHA" ] || [ -z "$HEAD_REPOSITORY" ]; then
            echo "::error title=Missing commit identity::workflow_run reported an empty head_sha or head_repository — refusing to evaluate its output."
            exit 1
          fi
          # Confirm the commit named above is a real commit in the named
          # repository — not merely a value present in the event payload —
          # before anything below trusts either one.
          if ! gh api "repos/${HEAD_REPOSITORY}/commits/${HEAD_SHA}" --silent; then
            echo "::error title=Commit not found::${HEAD_SHA} is not a commit ${HEAD_REPOSITORY} reports having — refusing to evaluate its output."
            exit 1
          fi
          echo "head_sha=$HEAD_SHA" >> "$GITHUB_OUTPUT"
          echo "head_repository=$HEAD_REPOSITORY" >> "$GITHUB_OUTPUT"

      - uses: actions/download-artifact@<PIN_A_FULL_COMMIT_SHA>
        with:
          name: inspector-inputs
          # Scopes the download to the exact run that was just verified
          # above, not "the most recent artifact with this name."
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}

      - uses: actions/setup-node@<PIN_A_FULL_COMMIT_SHA>
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
          scope: "@clossys"

      - run: npm ci --ignore-scripts
        env:
          NODE_AUTH_TOKEN: ${{ secrets.PACKAGES_READ_TOKEN }}

      # ---- DECIDE ------------------------------------------------------
      # Same two guards as the single-job template's decision step (see "On
      # never piping the decision step" above) — they apply unchanged here.
      - name: inspector
        id: decide
        run: |
          set -o pipefail
          report="$RUNNER_TEMP/inspector-report.txt"
          status=0
          npx inspector \
            --inputs verify-inputs.json \
            --declared-range "$(node -p "require('./package.json').devDependencies['@clossys/inspector']")" \
            > "$report" || status=$?
          cat "$report"
          cat "$report" >> "$GITHUB_STEP_SUMMARY"
          echo "status=$status" >> "$GITHUB_OUTPUT"

      # `workflow_run` never attaches its own job status to the pull request
      # the way `pull_request` does automatically — nothing here is a status
      # check on the PR until something explicitly makes it one. This posts
      # a Check Run against `workflow_run.head_sha`, re-read directly from
      # the triggering event, never a SHA read out of the artifact.
      #
      # Deliberately NOT `steps.run.outputs.head_sha`: that output is only
      # written once the verification step above reaches its last line, and
      # this step must still post a FAILURE check when verification exits
      # early (`if: always()`, below) — a required check a failed
      # verification leaves silently pending, instead of red, is a required
      # check that never reports failure. Reading the event field directly
      # here does not reopen the "re-derive, do not believe" gap above:
      # `workflow_run.head_sha` was always the re-derived value in both
      # places — this step uses the raw one, unconditionally, only to name
      # which commit a pass/fail check belongs to; the verification step
      # uses the same value to additionally confirm, before anything
      # evaluates the artifact, that the commit is real. Posting a check
      # against a SHA does not evaluate anything that validation protects.
      - name: Post the required status check
        if: always()
        env:
          GH_TOKEN: ${{ github.token }}
          HEAD_SHA: ${{ github.event.workflow_run.head_sha }}
          STATUS: ${{ steps.decide.outputs.status }}
        run: |
          set -euo pipefail
          test -n "$HEAD_SHA"
          conclusion="success"; [ "$STATUS" = "0" ] || conclusion="failure"
          gh api "repos/${{ github.repository }}/check-runs" \
            -f name="inspector" \
            -f head_sha="$HEAD_SHA" \
            -f status="completed" \
            -f conclusion="$conclusion"
```

The inputs-document JSON shape below is unchanged between the two shapes —
`decide` reads exactly the same schema `collect` assembled. Splitting the
job changes who runs which half and what each half is allowed to hold, not
what the document itself says.

### Which known trap this shape avoids, and which it does not

Two failure modes have shown up repeatedly in shapes that try to solve this:
a credentialed step running on untrusted code, or a required check that
resolves its own definition from the base branch so tightly that the pull
request meant to repair it is judged by the version it is trying to fix.
Naming both against this shape, rather than leaving either implicit:

- **Avoided: a credentialed step running on untrusted code.** `decide` holds
  the real registry credential and never checks out, builds, or executes the
  pull request's own code — not even implicitly through a shared checkout.
  Its only contact with the untrusted run is one downloaded JSON artifact,
  and that artifact is treated as data to evaluate, not code to run, the
  same design principle the package itself is built on (see "Why the
  collection lives in the caller, not in the package" above). This is the
  concrete difference from a `pull_request_target` job that checks out the
  pull request's head to test it: that job runs fork-authored code with the
  credential present. This one never runs fork-authored code at all.
- **Not avoided, and not avoidable here: the decide workflow's own
  definition is pinned to the base branch.** `workflow_run` — like
  `pull_request_target` — always executes the copy of `inspector-decide.yml`
  that lives on the repository's default branch, never the copy a pull
  request proposes, even a pull request that fixes a bug in this exact file.
  That fix only takes effect for the run *after* it merges; it cannot verify
  itself in its own pull request. This is not a gap in this shape, it is the
  mechanism that makes the credential separation possible at all — a
  workflow whose own definition could be edited by the code it is about to
  judge is the credential-boundary violation restated, not avoided. This
  repository's own CI already accepts the identical trade-off for a
  different credentialed step (`.github/workflows/ci.yml`'s
  `.trusted-scripts` checkout, pinned to the pull request's base SHA for the
  same reason its own comment gives) — nothing above is a new risk to a
  consuming repository, only the same one, restated where a fork-accepting
  caller needs to see it stated plainly.

### Is the gate published somewhere anonymously readable?

No — decided, not left open. GitHub Packages requires an authenticated,
`read:packages`-scoped token for every install, regardless of a package's
visibility; there is no "public means anonymous" tier on this registry the
way npmjs.org has one. Achieving genuine anonymous installability would mean
also publishing to a registry that supports it — a second, ongoing
publishing-strategy commitment (a second provenance chain, a second
visibility setting to keep from drifting out of sync with the first) that
belongs to the package's own release process, not to any one consuming
repository's caller workflow. The two-workflow split above is the recorded
alternative instead: it needs no anonymous read at all, because the only job
that ever installs the package is the one job that already holds a real
credential.

---

## The inputs document

One JSON file. `schemaVersion` is required and is checked, not assumed — a
document written for a schema this build does not read produces `2` with a
named reason rather than a partial read.

```jsonc
{
  "schemaVersion": 1,

  "secretScan": {
    "observation": {
      // `false` when the scanner step died before scanning. This is the
      // field that keeps a tool outage from reading as a clean repository.
      "attempted": true,
      "toolName": "the-scanner",
      "toolVersion": "8.30.1",
      "exitCode": 0,
      "scope": "full-history",
      // A clean run over zero units is not a clean repository.
      "unitsScanned": 412,
      "hits": []
    }
  },

  "taskRecord": {
    "observation": {
      "eventKind": "pull_request",
      "description": "<the pull request body>",
      "authorId": "<the author's login>",
      "headRef": "<the source branch>",
      "labels": [],
      "trackerScope": "<the owner/name this run's token can read>",
      // The caller's own lookup result. "not-visible" and "unavailable" are
      // both indeterminate: a scoped token answers identically for an item
      // that is absent and one it may not read.
      "item": { "outcome": "resolved", "title": "..." }
    },
    "policy": {
      "applicableEventKinds": ["pull_request"],
      "exemptLabels": ["<an exempt label>"],
      "exemptAuthorSuffixes": ["[bot]"],
      "exemptHeadRefPrefixes": ["<a release-automation branch prefix>"],
      "recordLabels": ["Work item"],
      "requireResolvedItem": true
    }
  },

  "reviewEvidence": {
    // The bundle shape from `@clossys/controller/review`. That
    // package's `./review/github` subpath normalizes a provider payload into
    // it without any network access of its own.
    "evidence": { "schemaVersion": 3, "headSha": "...", "baseSha": "...", "paginationComplete": true, "checks": [], "reviews": [], "threads": [] },
    "policy": { "requiredChecks": ["<a required context>"], "requireApproval": false, "requireSecondaryReview": false, "decisionUse": "advisory" },
    "options": { "requireReviewPresence": true, "headShaUnderTest": "..." }
  },

  "policyDrift": {
    "observation": {
      // What this repository states it requires.
      "declaredRequirements": [{ "id": "<a required context>" }],
      // What the enforcing system actually has configured. OMIT this key
      // when it could not be read — an absent measurement is indeterminate,
      // and an empty array would claim "nothing is enforced".
      "liveRequirements": [{ "id": "<a required context>" }],
      "liveSource": "<how it was measured>",
      "liveComplete": true
    },
    "options": { "allowUndeclaredLiveRequirements": false }
  }
}
```

### An omitted section is a failure, not a skip

There is no section whose absence means "do not check this". An omitted
section makes its check `indeterminate` with a named reason and the run exits
`2`. To genuinely not run a check, narrow `--checks` — which is visible on
the command line and in the report, where a reviewer can see it.

Selecting no checks at all exits `2` as well.

---

## What the consuming repository still owns

- Its own declared standard, review policy, exemption lists, and required
  contexts. All of them are values; none of them live in this package.
- Every credential its collection steps use.
- Whether a failing verdict blocks a merge.
- Bumping the package version, through the same dependency process it already
  applies to everything else it installs.
