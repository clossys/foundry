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
          registry-url: https://npm.pkg.github.com
          # Required, and not a formality. With `scope` omitted, this action
          # maps the *consuming repository's own owner* to the registry above,
          # so a consumer in any other account routes this package to the
          # public registry instead and the install fails to resolve it.
          scope: "@vespeneventures"

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
            --declared-range "$(node -p "require('./package.json').devDependencies['@vespeneventures/inspector']")" \
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
credentials decide what it looks like.

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
    // The bundle shape from `@vespeneventures/controller/review`. That
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
