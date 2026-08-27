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
   artifact, performs its one fixed credentialed install, then runs Bootstrap,
   Advisor, and the target gate with no credential.

`pull_request_target` is intentionally absent. The trusted job never checks
out or executes pull-request code.

## Repository files

Keep the request in the protected base, for example at
`.adoption-bootstrap/request.json`. It carries exact target and Advisor package
identities and the two snapshot-relative evidence paths. It is a declared
contract, not a command runner. The pull-request code may change an evidence
file, but cannot turn the base request into an arbitrary shell command or a
different executable path.

The snapshot artifact contains this fixed shape:

```text
snapshot.json
evidence/assessment.json
evidence/target-input.json
```

The pull-request job writes `snapshot.json` with the GitHub event facts and
file sizes/SHA-256 values. Bootstrap independently checks the downloaded files
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
            .adoption-bootstrap/request.json \
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
process execution; Bootstrap revalidates those generic security decisions.

## Trusted base decision and direct invocation

The `workflow_run` trigger fires whether the source run succeeded, failed, or
was cancelled. Do not put a job-level `if:` around it: a skipped required job
is a green GitHub check. Put the source conclusion in `trusted-event.json`;
anything other than `success` becomes Bootstrap exit `2`.

```yaml
name: Adoption decision

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

      # This is the only credentialed step. It is deliberately fixed; do not
      # replace it with an input command, a package runner, or lifecycle hooks.
      # The step writes a receipt even on failure; Bootstrap's later decision
      # re-raises the known 1, so continue-on-error cannot turn the workflow
      # green.
      - name: Fixed npm install
        id: fixed-install
        continue-on-error: true
        env:
          NODE_AUTH_TOKEN: ${{ secrets.PACKAGES_READ_TOKEN }}
        run: |
          set +e
          npm ci --ignore-scripts
          status=$?
          set -e
          node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({schemaVersion:1,packageManager:"npm",attempted:true,exitCode:Number(process.argv[2])}) + "\n")' "$RUNNER_TEMP/install-receipt.json" "$status"
          exit 0

      # The caller does not choose a file path. This small fixed resolver reads
      # Bootstrap's installed manifest, validates its bin string is contained,
      # and writes that derived path for the next step.
      - name: Derive Bootstrap executable from its installed manifest
        run: |
          node --input-type=module - <<'NODE'
          import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
          import { relative, resolve, sep } from "node:path";
          const root = realpathSync(process.cwd());
          const packageRoot = realpathSync(resolve(root, "node_modules/@vespeneventures/adoption-bootstrap"));
          const contained = (candidate) => { const value = relative(packageRoot, candidate); return value === "" || (!value.startsWith(`..${sep}`) && value !== ".."); };
          const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
          const bin = manifest?.bin?.["adoption-bootstrap"];
          if (manifest?.name !== "@vespeneventures/adoption-bootstrap" || typeof bin !== "string" || bin.startsWith("/") || bin.includes("\\") || bin.split("/").includes("..")) throw new Error("invalid installed Bootstrap manifest/bin");
          const executable = resolve(packageRoot, bin);
          if (!contained(executable) || lstatSync(executable).isSymbolicLink()) throw new Error("Bootstrap bin escapes its installed package");
          writeFileSync(process.env.RUNNER_TEMP + "/adoption-bootstrap-cli", realpathSync(executable));
          NODE

      # Event facts come from workflow_run, not from the artifact. A missing
      # pull_requests[0] field becomes malformed evidence and exits 2.
      - name: Write trusted event facts
        env:
          EVENT_JSON: ${{ toJSON(github.event.workflow_run) }}
        run: |
          node -e 'const fs=require("node:fs"); const run=JSON.parse(process.env.EVENT_JSON); const pull=run.pull_requests?.[0]; fs.writeFileSync(process.argv[1], JSON.stringify({schemaVersion:1,provider:"github-actions",eventName:"workflow_run",repository:process.env.GITHUB_REPOSITORY,baseSha:pull?.base?.sha ?? "",sourceWorkflowRunId:String(run.id ?? ""),sourceHeadSha:run.head_sha ?? "",artifactName:`adoption-snapshot-${String(run.id ?? "")}`,sourceConclusion:run.conclusion ?? ""}) + "\n")' "$RUNNER_TEMP/trusted-event.json"

      # No credential environment is attached to this step. It does not use a
      # pipeline: the captured status is printed and then re-raised exactly.
      - name: Decide readiness and invoke direct installed CLIs
        run: |
          set -o pipefail
          report="$RUNNER_TEMP/adoption-report.json"
          output="$RUNNER_TEMP/adoption-decision.txt"
          status=0
          node "$(cat "$RUNNER_TEMP/adoption-bootstrap-cli")" decide \
            .adoption-bootstrap/request.json \
            "$RUNNER_TEMP/adoption-snapshot" \
            "$RUNNER_TEMP/trusted-event.json" \
            "$RUNNER_TEMP/install-receipt.json" \
            --report "$report" > "$output" || status=$?
          cat "$output"
          cat "$output" >> "$GITHUB_STEP_SUMMARY"
          exit "$status"

      - uses: actions/upload-artifact@<FULL_COMMIT_SHA>
        if: always()
        with:
          name: adoption-decision-${{ github.event.workflow_run.id }}
          path: ${{ runner.temp }}/adoption-report.json
          if-no-files-found: error
          retention-days: 7
```

For pnpm, change only the fixed install step and the request's
`packageManager` together:

```bash
pnpm install --frozen-lockfile --ignore-scripts
```

The `./pnpm` adapter validates the matching `pnpm-lock.yaml` importer,
package version, and integrity. Do not accept a caller-provided installation
command, package-manager executable, package-runner shortcut, target CLI path,
or target argument array as a compatibility extension.

## Required result behaviour

- `0` means fixed installation succeeded, all joins are current, Advisor is
  ready at the runner's current instant, its returned plan contains the exact
  target name/version/integrity, and the direct target CLI returned consistent
  JSON `state: "satisfied"` and exit `0`.
- `1` means a fixed installation, Advisor readiness, or target CLI reported a
  known violation. It remains the workflow result.
- `2` means any evidence was missing, stale, foreign, malformed, skipped,
  inconsistent, unsafe to read, or otherwise could not be established. It is
  not softened to `0`.

Foundation is not activation: a foundation request is deliberately `2` even
after it pins packages and proves the local caller can be installed. An
activation change later supplies current evidence and must demonstrate a real
production `0`, plus adjacent realistic `1` and `2` controls owned by that
consumer.
