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
on: pull_request

permissions:
  contents: read
  pull-requests: read
  issues: read

concurrency:
  group: verify-standards-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # The job id and the job name match, so the required-status-check context
  # string stays stable when the display name is edited.
  verify-standards:
    name: verify-standards
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

      # Installed from this repository's own lockfile, like every other
      # dependency, so the resolved version is reviewable in a diff and swept
      # by whatever dependency-freshness process this repository already runs.
      - run: npm ci
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
      # One command, no credentials, no network. Its exit code is the job's.

      - name: verify-standards
        run: |
          npx verify-standards \
            --inputs verify-inputs.json \
            --declared-range "$(node -p "require('./package.json').devDependencies['@vespeneventures/verify-standards']")" \
            | tee -a "$GITHUB_STEP_SUMMARY"

      # Keeping the inputs is what makes a disputed verdict re-checkable
      # later, offline, without re-running any collection.
      - uses: actions/upload-artifact@<PIN_A_FULL_COMMIT_SHA>
        if: always()
        with:
          name: verify-standards-inputs
          path: verify-inputs.json
```

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
    // The bundle shape from `@vespeneventures/governance/review`. That
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
