# The thin caller workflow

This document is the consumer-side half of `builder-verify-toolchain`, the
first shared CI gate this package ships (#257). It is the same split
`@vespeneventures/verify-standards` already uses, applied to a new subject:
the package holds the grammar and the decisions; a consuming repository
holds the values, the credentials, and the collection.

Nothing here is a value this package endorses. Every name, version, and path
below is a placeholder for something the consuming repository chooses.

---

## Why this is a package with a CLI, not a reusable workflow reference (#257)

#257 laid out three real shapes a shared CI gate could take from a package
repository that has, until now, only ever shipped importable TypeScript:

- **Foundry hosts a reusable workflow directly**
  (`uses: vespeneventures/foundry/.github/workflows/_gate.yml@<ref>`).
- **Foundry publishes a composite GitHub Action**
  (`uses: vespeneventures/foundry/actions/gate@<ref>`).
- **Foundry publishes the gate's logic as an npm package; each repository
  keeps a thin workflow of its own, invoking it.**

Both `uses:`-based shapes are consumed the same way, and both fail the same
test: this account family treats a cross-account `uses:` as out of bounds,
with exactly one sanctioned exception — a downstream **package** depending on
an upstream package. A `uses:` pointing at another account's workflow or
action is not that exception, publicness of the provider repository
notwithstanding. A repository in a different account could not adopt either
shape without violating that boundary or carving out a standing exception
for it specifically.

The package-and-thin-workflow shape is the only one that crosses the
boundary the way this account family already permits it to be crossed, and
it costs nothing new to build: this package's release, versioning, and
safety machinery already exist for every other export it ships. It is also
already proven inside this same repository — `@vespeneventures/verify-standards`
ships exactly this split for a different set of checks, and the CLI below
reuses its exit-code contract and its staleness-floor mechanism rather than
inventing either a second time.

## Why the collection lives in the caller, not in the package

Every check this package runs is a pure function of observations someone
else gathered:

1. **The package needs no credential of its own.** Nothing that reads a real
   machine, a registry, or a provider API crosses the package boundary,
   because the package never calls anything.
2. **The verdict is auditable.** The inputs document is a file. It can be
   uploaded as a run artifact, diffed, and re-fed to the CLI offline to
   reproduce a verdict exactly.
3. **"The tool did not run" survives.** A step that collects can report that
   it failed to collect. A step that collects *and* decides has, by the time
   it decides, lost the distinction between "nothing was found" and "nothing
   was looked for" — the distinction `declared-but-not-verifiable` exists to
   preserve. See the package README's `liveStateSurface` section.

---

## The workflow

```yaml
name: Verify toolchain

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read

concurrency:
  group: verify-toolchain-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify-toolchain:
    name: verify-toolchain
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@<PIN_A_FULL_COMMIT_SHA>

      - uses: actions/setup-node@<PIN_A_FULL_COMMIT_SHA>
        with:
          node-version: 20
          registry-url: https://npm.pkg.github.com
          scope: "@vespeneventures"

      - run: npm ci --ignore-scripts
        env:
          NODE_AUTH_TOKEN: ${{ secrets.PACKAGES_READ_TOKEN }}

      # ---- COLLECT -------------------------------------------------------
      # Read the LIVE machine this job is actually running on. This step
      # never fails the job on its own -- a read that could not complete
      # becomes `attempted: false` with a named blocker in the inputs
      # document below, which is what turns into `declared-but-not-verifiable`
      # rather than a silently skipped check.
      - name: Observe the live toolchain
        id: observe
        continue-on-error: true
        run: |
          node -e "console.log(process.version)" > node-version.txt
          npm --version > npm-version.txt

      - name: Assemble the inputs document
        run: |
          node -e '
            const fs = require("node:fs");
            const attempted = "${{ steps.observe.outcome }}" === "success";
            const declaration = {
              runtime: { name: "node", version: "20.11.1" },
              packageManager: { name: "npm", version: "10.5.0" },
              buildOrder: { packages: ["policy", "governance", "builder"] },
            };
            const observation = attempted
              ? {
                  runtime: { attempted: true, live: fs.readFileSync("node-version.txt", "utf8").trim() },
                  packageManager: { attempted: true, live: fs.readFileSync("npm-version.txt", "utf8").trim() },
                  buildOrder: { attempted: true, live: declaration.buildOrder.packages },
                }
              : {
                  runtime: { attempted: false, blocker: "collection step failed on this runner" },
                  packageManager: { attempted: false, blocker: "collection step failed on this runner" },
                  buildOrder: { attempted: false, blocker: "collection step failed on this runner" },
                };
            fs.writeFileSync("verify-toolchain-inputs.json", JSON.stringify({ schemaVersion: 1, declaration, observation }));
          '

      # ---- DECIDE --------------------------------------------------------
      # One command, no credentials, no network. Its exit code is the job's
      # -- and the block below exists to keep that sentence literally true.
      - name: builder-verify-toolchain
        run: |
          # DO NOT pipe the CLI into `tee`. GitHub Actions runs a `run:`
          # block as `bash -e {0}`: `-e` is set, `-o pipefail` is NOT. A
          # pipeline's exit status is its LAST command's, so
          # `builder-verify-toolchain ... | tee` reports tee's `0` and
          # throws the real verdict away -- a `drifted` (1) or
          # `could-not-verify` (2) run renders its real verdict into the job
          # summary while the step itself goes green. This already happened
          # for real to a sibling gate in this repository (see
          # @vespeneventures/verify-standards's own caller-workflow document)
          # and is not a hypothetical here either.
          #
          # Two independent guards:
          #   1. `set -o pipefail` restores a pipeline's real status for
          #      anything added to this step later.
          #   2. The decisive command is in no pipeline at all. It writes to
          #      a file, its status is captured explicitly, the summary is
          #      appended afterwards, and the step ends by re-raising that
          #      status.
          set -o pipefail
          report="$RUNNER_TEMP/verify-toolchain-report.txt"
          status=0
          npx builder-verify-toolchain \
            --inputs verify-toolchain-inputs.json \
            --declared-range "$(node -p "require('./package.json').devDependencies['@vespeneventures/builder']")" \
            > "$report" || status=$?
          cat "$report"
          cat "$report" >> "$GITHUB_STEP_SUMMARY"
          exit "$status"

      - uses: actions/upload-artifact@<PIN_A_FULL_COMMIT_SHA>
        if: always()
        with:
          name: verify-toolchain-inputs
          path: verify-toolchain-inputs.json
```

### Never resolve "can't run here" with an `if:` skip

A job or step gated with `if:` that evaluates false is reported to GitHub's
merge gate as a *passing* required check, not as absent and not as failed.
If this gate cannot run on some trigger (a fork pull request with no
`PACKAGES_READ_TOKEN`, say), the correct behaviour is for the job to run and
exit `2` — via the `attempted: false` / named-blocker path above — never to
skip itself with `if:` and let the merge gate read the skip as a pass. This
is the same failure #257's own triggering incident names: a gate that
quietly stops running under one specific trigger condition while continuing
to report success.

### On never piping the decision step

See the block comment inside the workflow above; it is not decorative. The
short version: GitHub Actions invokes a `run:` block as `bash -e {0}`, with
`pipefail` off by default, so a piped decision command silently reports the
pipe's own exit status instead of the gate's.

### On what a `2` means

Exit `2` is not a softer `1`. It means some part of the run could not be
evaluated, so nothing about that part has been established in either
direction. There is no flag anywhere in this package that turns a `2` into a
`0`. Whether a `2` blocks a merge is this repository's own branch-protection
decision, made in this repository.

---

## The inputs document

```jsonc
{
  "schemaVersion": 1,
  "declaration": {
    "runtime": { "name": "node", "version": "20.11.1" },
    "packageManager": { "name": "npm", "version": "10.5.0" },
    "buildOrder": { "packages": ["<package>", "<package>"] }
  },
  "observation": {
    "runtime": { "attempted": true, "live": "20.11.1" },
    "packageManager": { "attempted": true, "live": "10.5.0" },
    // `attempted: false` with a named `blocker` -- never an omitted section
    // -- is how a read that could not run is reported.
    "buildOrder": { "attempted": false, "blocker": "no read access to the build log on this runner" }
  }
}
```

## What the consuming repository still owns

- Its own toolchain pins: the real runtime version, the real package-manager
  version, the real build order.
- Every credential its own collection step uses, if the live read this gate
  reconciles against needs one at all.
- Whether a `drifted` or `could-not-verify` verdict blocks a merge.
- Bumping the package version, through the same dependency process it
  already applies to everything else it installs.
