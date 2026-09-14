# Attestation freshness: an early warning, not a new gate

This repository is public and names only itself (see AGENTS.md and
`scripts/check-foreign-references.mjs`), so this document deliberately
describes the mechanism in the abstract rather than citing any specific
consumer repository, product, or incident by name. The pattern behind it is
real and was observed across this fleet's private consumer repositories: a
time-boxed governance record expired with no warning, fed a REQUIRED status
check, and froze every merge into a repository that, at the same moment,
needed to take a live security fix.

`scripts/check-attestation-freshness.mjs` and this document are the fix: a
scheduled scanner and a per-repository enforcement registry that says, for
every time-boxed record, whether it is really wired to a required check or
only declared. Neither one changes what any repository enforces. The
reconfirm-and-lengthen decision on an actual record stays with that record's
own accountable sponsor, and no automation here ever edits a record's own
dates.

## Two different problems, and why one scanner covers both

A time-boxed record takes one of two shapes:

- **A date field**: `freshUntil`, `expiresAt`, `validUntil`, `nextReviewAt`,
  `reviewBy`, `reviewDate`. The deadline is the field's own value.
- **A budget-days field**: `_stalenessBudgetDays` or `stalenessBudgetDays`, a
  plain number of days measured from an anchor timestamp in the same JSON
  object (`asOf`, `measuredAt`, `verifiedAt`, `assessedAt`, `generatedAt`,
  `observedAt`, `lastVerifiedAt`, or `reportedAt`). Without an anchor field
  present, the deadline cannot be computed and the record is reported
  `unanchored` rather than guessed at.

`scripts/check-attestation-freshness.mjs` recognises both shapes by field
name, plus a conservative fallback pattern for a differently-cased or newly
invented name, anywhere in a repository's tracked JSON files. It is not
limited to `governance/**` or `strategy/**`: a repository is free to keep a
time-boxed record elsewhere.

Test fixtures are excluded by path (any segment containing `fixtures`) so a
package's own gate tests, which plant fields named exactly like the real
thing, never get counted as live attestations. A `freshUntil` of `2099`
inside `governance/release-qualification-fixtures/...` in this very
repository is exactly that kind of fixture.

## Declared versus enforced: the rule that keeps this warning honest

A field that looks like a budget is not necessarily wired to anything. A
record can be:

- read only by a dashboard or reporting script that no workflow ever
  invokes, and that sets no failing exit code on its own, so it enforces
  nothing even though it looks identical to a blocking record on paper; or
- read at a path a repository's own checker does not evaluate as a live
  expiry at all, so an expired record sits there confirmed non-blocking; or
- read by a script, invoked by a workflow, whose result genuinely feeds a
  REQUIRED status check on the default branch.

All three are structurally indistinguishable from each other if the only
thing read is the record's own JSON. So the scanner never infers enforcement
from a field's presence. It trusts only an explicit, hand-authored
**enforcement registry** entry naming the reader script, the workflow, and
the exact required-status-check context, and then cross-checks that claim
against a **live** snapshot of the repository's rulesets before calling
anything `enforced`.

`repos/{owner}/{repo}/rulesets` is the only source this trusts for
"required". `branches/{branch}/protection` 404s even when a ruleset is
actively enforcing, which would make a genuinely blocking repository look
unprotected to anything that asked the wrong endpoint.

A registry entry the live snapshot cannot confirm is reported as
`enforcement-drift`, never silently trusted in either direction. That is the
same discipline this repository's own `check:merge-policy` already applies to
a different live-API fact: compare a stored declaration against the forge's
current answer, and fail loud on drift rather than trusting the older of the
two.

## The enforcement registry

Each consuming repository authors its own `governance/attestation-registry.json`.
The scanner never guesses this content; it is only as good as the audit
behind it.

```json
{
  "version": 1,
  "records": [
    {
      "file": "strategy/facts/traction.json",
      "field": "_stalenessBudgetDays",
      "readerScript": "scripts/traction-dashboard.mjs",
      "workflow": null,
      "requiredCheckContext": null,
      "notes": "Read only by a dashboard script invoked by no workflow. Declared, not enforced."
    },
    {
      "file": "governance/advisor-assessment.json",
      "field": "freshUntil",
      "readerScript": "node_modules/.bin/advisor-check",
      "workflow": ".github/workflows/advisor-freshness.yml",
      "requiredCheckContext": "advisor-freshness",
      "rulesetEvidence": {
        "verifiedAt": "2026-09-14T12:00:00Z",
        "rulesetId": 4821,
        "rulesetName": "main",
        "sourceCommand": "gh api repos/<owner>/<repo>/rulesets"
      }
    }
  ]
}
```

A record with no entry is reported `unregistered`: treated as declared, and
flagged as needing an audit, never assumed safe.

## The scheduled workflow

Each consuming repository adds one scheduled workflow. It never runs on
`pull_request`, so it structurally cannot become a merge gate:

```yaml
name: Attestation freshness watch
on:
  schedule:
    - cron: "0 8 * * *"
  workflow_dispatch: {}

permissions:
  contents: read
  issues: write
  administration: read

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Snapshot live rulesets
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh api "repos/${{ github.repository }}/rulesets" --jq \
            '[.[] | select(.target == "branch")]' > rulesets-index.json
          node scripts/fetch-ruleset-contexts.mjs rulesets-index.json > rulesets.json
      - name: Fetch the shared scanner
        run: |
          curl -fsSL \
            https://raw.githubusercontent.com/clossys/foundry/main/scripts/check-attestation-freshness.mjs \
            -o check-attestation-freshness.mjs
      - name: Scan
        run: |
          node check-attestation-freshness.mjs . \
            --registry governance/attestation-registry.json \
            --rulesets rulesets.json \
            --json > report.json
      - name: File or update the tracking issue
        env:
          GH_TOKEN: ${{ github.token }}
        run: node scripts/report-attestation-freshness.mjs report.json
```

`scripts/fetch-ruleset-contexts.mjs` (repository-specific, not shipped here)
resolves each branch-target ruleset's own detail endpoint into the
`{ id, enforcement, requiredStatusContexts }` shape `--rulesets` expects.
`scripts/report-attestation-freshness.mjs` renders `report.json` into one
tracking issue, grouped `Enforced (urgent)` above `Declared (informational)`,
and searches for an existing open issue with a fixed title before creating a
new one, so a repository accumulates one updated issue per run rather than a
new one every time.

## Warning lead time

The scanner's defaults (`--enforced-lead-days 14`, `--declared-lead-days 3`)
are asymmetric on purpose. An enforced record freezes every merge the moment
it lapses, so it needs enough runway for a human sponsor to act; a declared
one costs nothing when it lapses, so a shorter, purely informational lead is
enough to keep the registry itself from silently going stale. Both are CLI
flags, not constants, because a short sponsor-grant window needs a shorter
absolute lead than a long one to still land inside its own window.

## What this does not do

It does not touch any attestation record's own dates. It does not decide
whether a repository's check should be required; that decision belongs to
the repository's owner, expressed through its rulesets. It does not run on a
schedule tighter than the shortest real budget in a consuming repository
requires, and it never gates a pull request. Its only output is an early,
correctly categorised warning, aimed at a tracking issue a human will
actually read before the deadline, not after it.
