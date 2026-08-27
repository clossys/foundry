# @vespeneventures/adoption-bootstrap

`@vespeneventures/adoption-bootstrap` is executable tooling for a consuming
repository's own adoption workflow. It captures no credential and makes no
business, role, lifecycle, grounding, or completion claim. Its narrow job is
to make a protected base join a pull-request evidence snapshot to authenticated
GitHub Actions event facts, fixed npm or pnpm installation evidence, Advisor's
runner-time readiness result, and one directly installed target CLI.

It is not a remote action. A consumer keeps its own thin workflow, package
credentials, artifact retention, blocking placement, business policy,
rollback, cadence, and outcome measurement. See
[`documents/caller-workflow.md`](documents/caller-workflow.md) for the
canonical two-phase shape.

## Install

Configure the consumer-owned GitHub Packages mapping and credential reference,
then pin an exact published version in that consumer's manifest and lockfile:

```bash
npm install --save-dev @vespeneventures/adoption-bootstrap@0.1.0
```

The public package registry still requires the consumer's own read credential.
The credential belongs only to that workflow's fixed install step; the
decision, Advisor, and target CLI steps receive none.

## Contract

The protected-base `BootstrapRequest` has no command string, shell fragment,
arbitrary argument list, package-manager path, or target CLI path. It instead
declares only exact package identities, a fixed package-manager kind, one
snapshot identity, and two normalized relative evidence paths.

```json
{
  "schemaVersion": 1,
  "phase": "activation",
  "packageManager": "npm",
  "snapshot": {
    "repository": "consumer/repository",
    "maxAgeMs": 3600000
  },
  "advisor": {
    "name": "@vespeneventures/advisor",
    "version": "0.1.3",
    "integrity": "<npm-sha512-sri>",
    "bin": "advisor-execution-readiness"
  },
  "target": {
    "name": "@vespeneventures/advisor",
    "version": "0.1.3",
    "integrity": "<npm-sha512-sri>",
    "bin": "advisor-check",
    "invocation": "single-json-input"
  },
  "evidence": {
    "assessment": "evidence/assessment.json",
    "targetInput": "evidence/target-input.json"
  }
}
```

`foundation` intentionally exits `2`: it can pin packages, install the local
caller, and collect evidence, but cannot claim activation, adoption, grounding,
or closure. `activation` can return `0` only when every join, fixed-install
receipt, exact manifest/lock identity, contained snapshot file, Advisor result,
Advisor-plan target binding, and target result is satisfied.

The only target invocation v1 supports is `single-json-input`: the path comes
from the captured snapshot and the executable comes from the installed
package's validated `bin` field. The caller can select neither a command nor a
CLI path.

## CLI

```bash
adoption-bootstrap decide \
  .adoption-bootstrap/request.json \
  "$RUNNER_TEMP/adoption-snapshot" \
  "$RUNNER_TEMP/trusted-event.json" \
  "$RUNNER_TEMP/install-receipt.json" \
  --report "$RUNNER_TEMP/adoption-report.json"
```

The package derives Advisor's and the target's executable paths from their
installed manifests after matching name, version, integrity, and lockfile
entries. It uses no shell and removes standard registry-token environment
variables from child processes. A token present in a decisive step produces
`2`, not a successful decision.

Exit codes preserve the underlying ternary exactly:

| Exit | State | Meaning |
| --- | --- | --- |
| `0` | `satisfied` | Fixed install, joins, readiness, and target gate all completed cleanly. |
| `1` | `violated` | A fixed installation, Advisor readiness, or target gate reached a known violation. |
| `2` | `indeterminate` | Input, containment, event joins, identity, output/exit consistency, freshness, or a required phase could not be established. |

Do not pipe the decision command through `tee` or make it conditional with a
GitHub Actions `if:`. Capture its output, append it after the command, and
re-raise its status as the caller template does.

## API

| Export | Description |
| --- | --- |
| `evaluateBootstrap()` | Purely joins typed request, snapshot, trusted event, install, and raw CLI observations into a `BootstrapReport`. |
| `evaluateProcessResult()` | Checks a raw JSON `state` and exit code retain the exact `0`/`1`/`2` mapping. |
| `isNormalizedRelativePath()` | Tests the portable relative-path grammar accepted for captured evidence. |
| `validateBootstrapRequest()` | Rejects malformed request data and every untyped command or CLI surface. |
| `BootstrapEvaluationInput` / `BootstrapFinding` / `BootstrapPhase` / `BootstrapReport` / `BootstrapRequest` / `BootstrapState` | Typed core input, report, phase, and outcome contracts. |
| `ExactPackage` / `InstallReceipt` / `PackageManager` / `ProcessObservation` / `SnapshotFile` / `SnapshotManifest` / `TargetPackage` / `TrustedEvent` | Typed identity, receipt, snapshot, process, target, and authenticated-event contracts. |

## Fixed package-manager subpaths

`@vespeneventures/adoption-bootstrap/npm` exports `NPM_CI_IGNORE_SCRIPTS` and
`validateNpmIdentity()`: the fixed `npm ci --ignore-scripts` adapter and exact
npm manifest/lock identity checker. `@vespeneventures/adoption-bootstrap/pnpm`
exports `PNPM_INSTALL_FROZEN_IGNORE_SCRIPTS` and `validatePnpmIdentity()` for
the fixed `pnpm install --frozen-lockfile --ignore-scripts` path. Neither
subpath accepts a command, a package-manager path, or caller options.

## Requirements

Node.js 20+, ESM, and no runtime dependencies. The consumer owns GitHub
Actions configuration and any registry credential; this package never reads a
provider API and includes no remote action or provider adapter.

## Licence

MIT.
