# Foundry Starter

Foundry Starter (`@clossys/starter`) is executable tooling for a consuming
repository's own adoption workflow. It captures no credential and makes no
business, role, lifecycle, grounding, or completion claim. Its narrow job is
to make a protected base join a pull-request evidence snapshot to authenticated
GitHub Actions event facts, fixed npm or pnpm installation evidence, Advisor's
runner-time readiness result, and one directly installed target CLI.

It is not a remote action. A consumer keeps its own thin workflow, artifact
access, retention, blocking placement, business policy,
rollback, cadence, and outcome measurement. See
[`documents/caller-workflow.md`](documents/caller-workflow.md) for the
canonical two-phase shape.

A `decide` verdict is about the protected base's installed packages. A pull
request that changes a pinned package is proved by `decide` only on the next
pull request after it merges. For npm callers, the optional `prove-head`
command proves the pull request's own install in the same trusted job
family, with no credential, without running any pull-request code. See
[Head-install proof](#head-install-proof).

## Install

Pin an exact public npm version in the consumer's manifest and lockfile:

```bash
npm install --save-dev --save-exact @clossys/starter@0.1.8
```

This package is published to the public npm registry, `https://registry.npmjs.org`.
Public npm reads are credentialless. Do not add a token or private registry
mapping for `@clossys`; the fixed install and every decisive CLI step receive
no registry credential. Pin the exact version the first-wave plan named;
`0.1.8` is this source version, not a claim that `latest` already matches it.

## Contract

The protected-base `StarterRequest` has no command string, shell fragment,
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
  "starter": {
    "name": "@clossys/starter",
    "version": "0.1.8",
    "integrity": "<npm-sha512-sri>",
    "bin": "foundry-starter"
  },
  "advisor": {
    "name": "@clossys/advisor",
    "version": "0.2.3",
    "integrity": "<npm-sha512-sri>",
    "bin": "advisor-execution-readiness"
  },
  "target": {
    "name": "@clossys/advisor",
    "version": "0.2.3",
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

`foundation` intentionally exits `2` after a successful fixed install: it pins
Starter, Advisor, and the target; validates all three exact manifest, lock,
integrity, and bin identities; and then makes no activation claim. In the
canonical caller templates, a failed initial native install is pre-runtime: the
workflow hard-fails before Starter exists, so no Starter `1` or `2` verdict is
claimed. It cannot claim activation, adoption, grounding, or closure.
`activation` can return `0` only when every join, fixed-install receipt, exact
manifest/lock identity, contained snapshot file, Advisor result, and target
result is satisfied. The returned `firstWavePlan.workItems` must authorize the
same consumer repository, package version/integrity, installed bin, and fixed
`single-json-input` invocation. `admission` is a third phase on this same
schema version 1 request; see [Admission](#admission).

The pure evaluator preserves a supplied `InstallReceipt`'s `0`/`1`/`2` state
for integrations that have already established an exact trusted Starter
runtime. That data contract does not turn the canonical initial install into a
Starter verdict: its failure remains pre-runtime as described above.

## Hub inventory evidence

The request may optionally carry a `hub` object — `{ "owner": "...",
"repository": "...", "inventoried": true | false }` — naming the account hub
and stating, on the caller's own evidence, whether this repository is
inventoried by it (issue #997). Starter treats it as evidence, never as a
prompt: it performs no I/O to obtain or verify the object, and an absent
`hub` changes nothing.

When `hub.inventoried` is `false`, the decision report gains one finding,
`not-hub-inventoried`, and nothing else changes: the state is not downgraded,
because flagging an un-inventoried repository is the hub's reconciliation
work, not an activation violation. The finding rides along in every result —
`satisfied`, `violated`, and `indeterminate` alike — so a caller reading the
report sees the gap even on a successful decision.

The only v1 supported target invocation is `single-json-input`; the hub
object adds no command surface and accepts no path.

GitHub provider facts are deliberately distinct from evidence commitments:
`snapshot.baseSha`, `snapshot.headSha`, `trustedEvent.baseSha`, and
`trustedEvent.sourceHeadSha` must each be a canonical 40-character lowercase
hex Git commit SHA-1 OID. The snapshot `digest` and each file `sha256` remain
canonical 64-character lowercase hex SHA-256 digests. A 64-character digest
cannot stand in for a GitHub commit OID.

## CLI

```bash
foundry-starter decide \
  .starter/request.json \
  "$RUNNER_TEMP/adoption-snapshot" \
  "$RUNNER_TEMP/trusted-event.json" \
  "$RUNNER_TEMP/install-receipt.json" \
  --report "$RUNNER_TEMP/adoption-report.json"
```

The package derives Starter's, Advisor's, and the target's executable paths
from their installed manifests after matching name, version, integrity, and
lockfile entries. It checks that the invoked Starter file itself is that exact
manifest-derived bin, uses no shell, and applies a fixed deadline to both
Advisor and target execution. It removes standard registry-token environment
variables from child processes. A token present in a decisive step produces
`2`, not a successful decision.

Exit codes preserve the underlying ternary exactly:

| Exit | State | Meaning |
| --- | --- | --- |
| `0` | `satisfied` | Fixed install, joins, readiness, and target gate all completed cleanly. |
| `1` | `violated` | After Starter begins, Advisor readiness or the target gate reached a known violation. |
| `2` | `indeterminate` | After Starter begins, input, containment, event joins, identity, output/exit consistency, freshness, timeout, or a required phase could not be established. |

Do not pipe the decision command through `tee` or make its job conditional with
a GitHub Actions `if:`. Capture its output, append it after the command, and
re-raise its status as the caller template does. A missing artifact or a failed
initial native install is a visible pre-runtime workflow failure, not a
synthetic Starter result.

## Head-install proof

```bash
foundry-starter prove-head \
  .starter/request.json \
  .starter-head \
  "$RUNNER_TEMP/trusted-event.json" \
  "$RUNNER_TEMP/starter-head-install" \
  --report "$RUNNER_TEMP/head-install-report.json"
```

`prove-head` runs from the protected base's installed Starter, after the
caller has sparse-checked-out the authenticated `workflow_run` head commit
into `.starter-head`. It reads the head's copy of the request (at the same
relative path), `package.json`, and `package-lock.json` as bounded data. It
also checks the checkout's `.git/HEAD` against the trusted head commit.

Starter refuses any manifest dependency spec, `overrides` entry, or lockfile
entry that is not a registry spec: a semver version or range, a dist-tag, or
an `npm:` alias to one (git, URL, file, link, workspace, portal, and path
specs are all refused, in `dependencies`, `overrides` at any depth, and every
lock entry's own dependency maps). Every lockfile entry must also be a
single-SHA-512 tarball from `https://registry.npmjs.org/`, named for its own
entry's name and version. It stages only the manifest's dependency fields and
the lockfile into a fresh directory. It runs `npm ci --ignore-scripts` there
under a literal environment with no token, no npmrc, and a fixed registry.
Once that install exits `0`, it also checks npm's own hidden lockfile,
`node_modules/.package-lock.json`, against the head's `package-lock.json`; an
unreadable hidden lockfile keeps the proof indeterminate, never satisfied. It
then checks the head request's exact Starter, Advisor, and target identities
from installed manifests and the lockfile. It never executes an installed
head package. The command takes four positional paths and an optional
`--report`, and no registry, command, or package-manager option.

The report is a separate `HeadInstallReport` (`kind: "head-install"`):

| Exit | State | Meaning |
| --- | --- | --- |
| `0` | `satisfied` | The head's own install completed and holds the head request's exact identities (`proved`). |
| `1` | `violated` | The head manifest or lockfile names a forbidden source, the post-install hidden lockfile disagrees with `package-lock.json`, or the head request pins an identity its own install does not hold. |
| `2` | `indeterminate` | A head file, the head commit, the base Starter's own identity, the staging directory, or the post-install hidden lockfile could not be established; the step carries a credential; the request names pnpm; or `npm ci` failed or timed out. |

A `0` proves the install only. The head's Advisor readiness and target
result are still proved by `decide` one merge later. It does not cover
lifecycle scripts, the merge result, workspaces, pnpm, or registry mirrors.
`changedFromBase` names the pins the pull request changes.

## Admission

`phase` may be `admission` on the same schema version 1 request. The request
still has no approval field and no ledger bytes. `decide` does not judge that
phase. `foundry-starter admit` does:

```bash
foundry-starter admit \
  .starter/request.json \
  . \
  .starter-head \
  --report "$RUNNER_TEMP/admission-report.json"
```

It reads `clossys/.state/installed.json` from the protected base directory and
from the pull-request head directory, and passes those bytes to the
installed-ledger succession reader. The comparison is that reader's canonical
bytes. A manifest spec for a ledger package must pass `isRegistrySpec()`, the
registry-spec grammar `prove-head` uses, which refuses a tarball filename.
`prove-head` itself stays the head-install proof.

| Exit | State | Meaning |
| --- | --- | --- |
| `0` | `satisfied` | The head ledger's canonical bytes are the base ledger's, or the head is the admitted next generation, and the base's frozen install matches the base ledger's packages, including integrity. |
| `1` | `violated` | The head ledger adds an act, names another plan digest or subject digest, leaves a deferral, breaks the history prefix, is a next generation whose last entry is labeled approved, or is another spelling of a ledger; or the frozen `npm ci` / `pnpm install --frozen-lockfile` result does not match a base ledger package. |
| `2` | `indeterminate` | The head ledger is absent or its bytes are not a readable ledger document, or the frozen install could not be read. |

A next generation whose last entry is labeled approved is a refusal. An
unchanged ledger, including a setup ledger whose last generation is approved,
is not. This comparison does not authenticate an approval.

## Close condition

Starter is executable tooling, not a role. Adoption, grounding, and closure
cells stay N/A: this package does not close a role loop.

The trusted-base job is done when a consuming repository's own two-phase
workflow invokes `foundry-starter decide` and retains the native ternary:
`foundation` stays `2` after a successful fixed install (no activation claim),
and `activation` is `0` only when every join, install receipt, Advisor
readiness, and target CLI result is satisfied. A green run of this package's
tests is not that evidence.

## API

| Export | Description |
| --- | --- |
| `admissionExitCode()` | Maps an `AdmissionReport` to exit `0` (satisfied), `1` (violated), or `2` (indeterminate). |
| `evaluateAdmission()` | Compares the protected base ledger with the pull-request ledger by canonical bytes, then compares the frozen base install with the base ledger's packages. |
| `evaluateHeadInstall()` | Purely derives the separate head-install `HeadInstallReport` from the base and head requests, trusted event, head commit, lockfile findings, install observation, and identity findings. |
| `evaluateStarter()` | Purely joins typed request, snapshot, trusted event, install, and raw CLI observations into a `StarterReport`. |
| `evaluateProcessResult()` | Checks a raw JSON `state` and exit code retain the exact `0`/`1`/`2` mapping. |
| `isNormalizedRelativePath()` | Tests the portable relative-path grammar accepted for captured evidence. |
| `validateStarterRequest()` | Rejects malformed request data and every untyped command or CLI surface. |
| `StarterEvaluationInput` / `StarterFinding` / `StarterPhase` / `StarterReport` / `StarterRequest` / `StarterState` | Typed core input, report, phase, and outcome contracts. |
| `AdmissionEvaluationInput` / `AdmissionInstall` / `AdmissionReport` | Typed admission input, frozen-install record, and ledger-comparison report. |
| `HeadInstallEvaluationInput` / `HeadInstallIdentity` / `HeadInstallObservation` / `HeadInstallReport` / `HeadInstallRole` | Typed head-install proof input, proved identity, npm observation, report, and request-role contracts. |
| `StarterHubEvidence` | The optional caller-supplied `hub` request object: `{ owner, repository, inventoried }`. |
| `ExactPackage` / `InstallReceipt` / `PackageManager` / `ProcessObservation` / `SnapshotFile` / `SnapshotManifest` / `TargetPackage` / `TrustedEvent` | Typed identity, receipt, snapshot, process, target, and authenticated-event contracts. |

## Fixed package-manager subpaths

`@clossys/starter/npm` exports `NPM_CI_IGNORE_SCRIPTS` and
`validateNpmIdentity()`: the fixed `npm ci --ignore-scripts` adapter and exact
npm manifest/lock identity checker. It also exports the head-install data
checks: `PUBLIC_NPM_REGISTRY`, `validateNpmLockfileSources()` and
`validateNpmManifestSources()` (both return `NpmHeadSourceFindings`),
`stagedNpmManifest()`, `isRegistrySpec()` (the registry-spec grammar a
dependency spec, an `overrides` value, or an `npm:` alias target must match),
and `compareHeadHiddenLockfile()` (returns a `HiddenLockfileComparison`) for
checking npm's post-install hidden lockfile against the head's
`package-lock.json`. `@clossys/starter/pnpm` exports
`PNPM_INSTALL_FROZEN_IGNORE_SCRIPTS` and `validatePnpmIdentity()` for the
fixed `pnpm install --frozen-lockfile --ignore-scripts` path. Neither install
adapter accepts a command, a package-manager path, or caller options.
`validateNpmLockfileSources()` and `validateNpmManifestSources()` are pure
validators. `validateNpmLockfileSources()`'s optional registry argument
defaults to the public registry, and `prove-head` never overrides it.

## Requirements

Node.js 20+, ESM, and no runtime dependencies. The consumer owns GitHub
Actions configuration and artifact access. Public npm package reads need no
registry credential; this package never reads a provider API and includes no
remote action or provider adapter.

## Licence

MIT.

## Changelog

Release notes for every version are in the [changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/starter.md), kept in the public repository rather than in the installed package.
