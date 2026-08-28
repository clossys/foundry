# The thin consumer-owned caller workflow

This is a template for a consuming repository, not a workflow to reference
from another repository. Copy it into the consumer, replace the placeholders
with that consumer's fixed values, and pin every third-party action to a full
commit SHA under that consumer's normal policy. It deliberately uses no remote
composite action and no package-runner shortcut.

The design has two phases:

1. An uncredentialed `pull_request` job checks out untrusted code and uploads
   only the evidence snapshot. It does not install packages, decide readiness,
   or receive a registry credential.
2. A trusted `workflow_run` job checks out the immutable PR base, obtains the
   artifact, performs one fixed credentialed native install, then runs Foundry
   Starter, Advisor, and the target gate with no credential.

`pull_request_target` is intentionally absent. The trusted job never checks
out or executes pull-request code.

## Repository files

Keep the request in the protected base, for example at
`.starter/request.json`. It carries exact target and Advisor package identities
and two snapshot-relative evidence paths. It is a declared contract, not a
command runner. The pull-request code may change an evidence file, but cannot
turn the base request into an arbitrary shell command, executable path, or
argument array. The request also pins Starter's own exact name, version,
integrity, and `starter` bin; Starter validates that identity from the selected
manager's installed manifest and lockfile before deciding.

The snapshot artifact contains this fixed shape:

```text
snapshot.json
evidence/assessment.json
evidence/target-input.json
```

The pull-request job writes `snapshot.json` with the GitHub event facts and
file sizes/SHA-256 values. The GitHub base and head values are canonical
40-character lowercase-hex Git commit SHA-1 OIDs; the snapshot and file
commitments are distinct 64-character lowercase-hex SHA-256 digests. Starter
independently checks the downloaded files
for normalized paths, a regular non-symlink file, realpath containment,
bounded size, and metadata agreement before it reads either JSON document.

## Uncredentialed evidence collection

```yaml
name: Adoption evidence

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read

jobs:
  collect-adoption-evidence:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@<FULL_COMMIT_SHA>
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          persist-credentials: false

      # Consumer-owned collection only. It reads the two paths from this PR's
      # request copy and writes a bounded snapshot artifact. It has no package
      # credential and must not run package, Advisor, or target commands.
      - name: Collect snapshot
        env:
          REPOSITORY: ${{ github.repository }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
          RUN_ID: ${{ github.run_id }}
        run: |
          node .github/scripts/collect-adoption-snapshot.mjs \
            .starter/request.json \
            "$RUNNER_TEMP/adoption-snapshot"

      - uses: actions/upload-artifact@<FULL_COMMIT_SHA>
        with:
          name: adoption-snapshot-${{ github.run_id }}
          path: ${{ runner.temp }}/adoption-snapshot
          if-no-files-found: error
          retention-days: 7
```

`collect-adoption-snapshot.mjs` is consumer-owned because the values and
evidence format are consumer-owned. Keep it boring: copy exactly the two
request paths, write their byte length and SHA-256 to `snapshot.json`, and
copy the GitHub event facts shown above. Do not give it a package credential or
teach it package installation, containment, event joins, ternary folding, or
process execution; Starter revalidates those generic security decisions.

## Trusted base decision and direct invocation

The `workflow_run` trigger fires whether the source run succeeded, failed, or
was cancelled. Do not put a job-level `if:` around it: a skipped required job
is a green GitHub check. The trusted job must begin for every conclusion.

Artifact download and the initial fixed dependency install are **pre-runtime**
boundaries. If either fails, the job fails visibly before Starter exists, so
there is no Starter verdict and no invented `1` or `2` receipt. If the source
workflow reached its artifact but reported a non-`success` conclusion, the
installed Starter receives that authenticated conclusion and returns `2`.

Choose one complete template below. They are deliberately separate: npm reads
only `package-lock.json` and runs `npm ci --ignore-scripts`; pnpm reads only
`pnpm-lock.yaml` and runs `pnpm install --frozen-lockfile --ignore-scripts`.
Neither branch accepts a caller-selected resolver, executable path, command, or
argument array.

### npm caller

```yaml
name: Adoption decision (npm)

on:
  workflow_run:
    workflows: [Adoption evidence]
    types: [completed]

permissions:
  actions: read
  contents: read

jobs:
  decide-adoption:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      # This is the PR BASE, not the source workflow's head SHA. It is the
      # only checkout the credentialed workflow executes.
      - uses: actions/checkout@<FULL_COMMIT_SHA>
        with:
          ref: ${{ github.event.workflow_run.pull_requests[0].base.sha }}
          persist-credentials: false

      - uses: actions/setup-node@<FULL_COMMIT_SHA>
        with:
          node-version: 20
          registry-url: https://npm.pkg.github.com
          scope: "@vespeneventures"

      - uses: actions/download-artifact@<FULL_COMMIT_SHA>
        with:
          name: adoption-snapshot-${{ github.event.workflow_run.id }}
          path: ${{ runner.temp }}/adoption-snapshot
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}

      # This is the only credentialed step. It is deliberately fixed; do not
      # replace it with an input command, package runner, or lifecycle hooks.
      # A failure stops the job before Starter exists: it is not a Starter 1/2.
      - name: Fixed npm install
        env:
          NODE_AUTH_TOKEN: ${{ secrets.PACKAGES_READ_TOKEN }}
        run: |
          npm ci --ignore-scripts
          node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({schemaVersion:1,packageManager:"npm",attempted:true,exitCode:0}) + "\n")' "$RUNNER_TEMP/install-receipt.json"

      # Event facts come from workflow_run, not from the artifact. A missing
      # pull_requests[0] field becomes malformed evidence and exits 2.
      - name: Write trusted event facts
        env:
          EVENT_JSON: ${{ toJSON(github.event.workflow_run) }}
        run: |
          node -e 'const fs=require("node:fs"); const run=JSON.parse(process.env.EVENT_JSON); const pull=run.pull_requests?.[0]; fs.writeFileSync(process.argv[1], JSON.stringify({schemaVersion:1,provider:"github-actions",eventName:"workflow_run",repository:process.env.GITHUB_REPOSITORY,baseSha:pull?.base?.sha ?? "",sourceWorkflowRunId:String(run.id ?? ""),sourceHeadSha:run.head_sha ?? "",artifactName:`adoption-snapshot-${String(run.id ?? "")}`,sourceConclusion:run.conclusion ?? ""}) + "\n")' "$RUNNER_TEMP/trusted-event.json"

      # No credential environment is attached to this step. The fixed path is
      # not caller data. Its captured outcome is printed and re-raised exactly.
      - name: Decide readiness and invoke direct installed CLIs
        run: |
          report="$RUNNER_TEMP/adoption-report.json"
          output="$RUNNER_TEMP/adoption-decision.txt"
          status=0
          node node_modules/@vespeneventures/starter/dist/cli.js decide \
            .starter/request.json \
            "$RUNNER_TEMP/adoption-snapshot" \
            "$RUNNER_TEMP/trusted-event.json" \
            "$RUNNER_TEMP/install-receipt.json" \
            --report "$report" > "$output" || status=$?
          cat "$output"
          cat "$output" >> "$GITHUB_STEP_SUMMARY"
          exit "$status"
```

### pnpm caller

```yaml
name: Adoption decision (pnpm)

on:
  workflow_run:
    workflows: [Adoption evidence]
    types: [completed]

permissions:
  actions: read
  contents: read

jobs:
  decide-adoption:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@<FULL_COMMIT_SHA>
        with:
          ref: ${{ github.event.workflow_run.pull_requests[0].base.sha }}
          persist-credentials: false

      - uses: actions/setup-node@<FULL_COMMIT_SHA>
        with:
          node-version: 20
          registry-url: https://npm.pkg.github.com
          scope: "@vespeneventures"

      - name: Enable pnpm
        run: corepack enable

      - uses: actions/download-artifact@<FULL_COMMIT_SHA>
        with:
          name: adoption-snapshot-${{ github.event.workflow_run.id }}
          path: ${{ runner.temp }}/adoption-snapshot
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}

      # This is the only credentialed step. It is deliberately fixed. A
      # failure stops the job before Starter exists: it is not a Starter 1/2.
      - name: Fixed pnpm install
        env:
          NODE_AUTH_TOKEN: ${{ secrets.PACKAGES_READ_TOKEN }}
        run: |
          pnpm install --frozen-lockfile --ignore-scripts
          node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({schemaVersion:1,packageManager:"pnpm",attempted:true,exitCode:0}) + "\n")' "$RUNNER_TEMP/install-receipt.json"

      - name: Write trusted event facts
        env:
          EVENT_JSON: ${{ toJSON(github.event.workflow_run) }}
        run: |
          node -e 'const fs=require("node:fs"); const run=JSON.parse(process.env.EVENT_JSON); const pull=run.pull_requests?.[0]; fs.writeFileSync(process.argv[1], JSON.stringify({schemaVersion:1,provider:"github-actions",eventName:"workflow_run",repository:process.env.GITHUB_REPOSITORY,baseSha:pull?.base?.sha ?? "",sourceWorkflowRunId:String(run.id ?? ""),sourceHeadSha:run.head_sha ?? "",artifactName:`adoption-snapshot-${String(run.id ?? "")}`,sourceConclusion:run.conclusion ?? ""}) + "\n")' "$RUNNER_TEMP/trusted-event.json"

      # No credential environment is attached to this step. This fixed path
      # works through pnpm's installed package link.
      - name: Decide readiness and invoke direct installed CLIs
        run: |
          report="$RUNNER_TEMP/adoption-report.json"
          output="$RUNNER_TEMP/adoption-decision.txt"
          status=0
          node node_modules/@vespeneventures/starter/dist/cli.js decide \
            .starter/request.json \
            "$RUNNER_TEMP/adoption-snapshot" \
            "$RUNNER_TEMP/trusted-event.json" \
            "$RUNNER_TEMP/install-receipt.json" \
            --report "$report" > "$output" || status=$?
          cat "$output"
          cat "$output" >> "$GITHUB_STEP_SUMMARY"
          exit "$status"
```

Set the protected-base request's `packageManager` to `npm` for the npm caller
or `pnpm` for the pnpm caller. Starter validates the matching root importer,
exact version, and integrity in that manager's lockfile. Do not combine the
templates or copy npm's resolver into the pnpm caller. The pnpm runtime reads
`pnpm-lock.yaml` and never reads `package-lock.json` for a pnpm request.

## Required result behaviour

- `0` means the fixed installation completed, all joins are current, Starter
  is itself the request's exact installed manifest/lock/bin identity, Advisor
  is ready at the runner's current instant, its returned `firstWavePlan`
  contains the exact target repository/name/version/integrity/bin/invocation,
  and the direct target CLI returned consistent JSON `state: "satisfied"` and
  exit `0`.
- `1` means Starter ran and Advisor readiness or the target CLI reported a known
  violation. It remains the workflow result.
- `2` means any evidence was missing, stale, foreign, malformed, skipped,
  inconsistent, unsafe to read, timed out, or otherwise could not be
  established after Starter began. It is not softened to `0`.

An unavailable artifact or failed initial native install is not a `1` or `2`
from Starter. It is a hard pre-runtime workflow failure: no Starter report or
verdict exists because no exact installed Starter was available to run.

Foundation is not activation: a foundation request is deliberately `2` after
it pins packages and proves the local caller can be installed. An activation
change later supplies current evidence and must demonstrate a real production
`0`, plus adjacent realistic `1` and `2` controls owned by that consumer.
