# @clossys/inspector

**Inspector judges a change before it lands.** One gate, one verdict
grammar, one place where the answer is computed and one place where it is
reported.

Formerly two packages. `verify-standards` was the repository-standards gate
a consumer's own thin workflow invoked — secret-scan attempts, task records,
review evidence, policy drift — and `secret-scan` was a verified `gitleaks`
binary downloader with zero consumers. They were one job wearing two names:
the standards gate already asked whether a secret scan had been *attempted*;
the scanner is the thing that attempts it. Shipping them separately meant the
gate could only ever check for evidence that the other package had run.
`inspector` is both, and the `./secret-scan` subpath now lets a caller
actually run a scan through this package rather than merely attest that one
happened somewhere else — while the attested path keeps working unmodified
for any caller that scans by other means. See
[Composition](#composition) below.

## The problem this exists to fix

The same CI gate gets built independently in every repository that wants one,
in whatever shape that repository reached for first: a hand-copied YAML file,
a workflow referenced across repositories, the same reference pinned to a
commit, a re-implementation embedded in a larger script. None of the copies
know about each other, so a fix discovered in one has no path to the rest.

That is not hypothetical. A licensing condition changed for a tool one such
gate wrapped. One copy's maintainer diagnosed it in advance and wrote the
warning into that copy's own header, correctly predicting which sibling would
hit it next. The prediction came true and the warning never travelled, because
there was no channel for it to travel through. Two further copies hit the same
wall the same day, each needing its own separate fix.

A package dependency is a channel. That is the entire argument for this shape.

## Composition

| module | job |
| --- | --- |
| package root (`.`) | the judge — four checks, each a pure function of caller-supplied observations: a secret-scan attempt, a change's task record, its review evidence, and drift between a declared standard and the live state enforcing it |
| `./secret-scan` | the mechanism — verified `gitleaks` binary acquisition (SHA-256 checked against a caller-stated value), and now, running it into an observation the judge above evaluates |

The judge never cares who produced an observation or how — that split is
what keeps every check here a pure function with no credential and no
network access of its own, and it is unchanged by this package absorbing the
mechanism half. A caller who scans with a different tool, or collects from a
step this package has never heard of, still builds the observation shape by
hand and still gets a real verdict. `./secret-scan` exists so a caller who
*wants* to run gitleaks does not have to reinvent the translation from its
report into this package's contract.

## Metric

**Escape rate: changes that reached the default branch and violated a rule,
divided by changes that landed.**

**This package must never compute that metric itself.** The measurer must
not be the measured — folding audit into the gate would let the system grade
its own homework, which is the exact failure that produced a gate printing an
incomplete verdict and exiting `0` in this repository's own history.
Computing escape rate is `observer`'s job, against whatever this gate (and
`controller`'s declared rules) actually decided. `inspector` reports one
verdict per run and nothing about its own historical accuracy; anything that
looks like a scorecard for this package belongs in `observer`, evaluated from
the outside.

## Loop

- **aim** — nothing lands that violates a `controller` rule.
- **sense** — read the change and the evidence attached to it.
- **judge** — satisfied (`0`) / violated (`1`) / indeterminate (`2`).
- **act** — report the verdict as the process exit status, never through a
  pipeline that can discard it.
- **learn** — a recurring `indeterminate` is a missing input contract, not a
  flaky gate.

**Close condition:** this loop closes when `observer` reports an escape rate
of zero, across a bounded run of landed changes, for every rule this gate
evaluates — never when this package's own run history looks clean, because
this package has no way to tell a clean history from an unmeasured one. A
nonzero rate is evidence a rule needs a check here (or a stronger one); it is
never evidence this gate should start counting its own escapes.

## Install

```bash
npm install --save-dev @clossys/inspector
```

The package is published to GitHub Packages, so a consuming project needs the
scope pointed at that registry and an authenticated `NODE_AUTH_TOKEN` before
installing — the same setup every other package in this scope already needs.

```ts
import { verifyStandards, checkSecretScan } from "@clossys/inspector";
```

## Use it as a command

```bash
inspector --inputs verify-inputs.json --declared-range "^0.1.0"
```

| Flag | Meaning |
| --- | --- |
| `--inputs <path>` | Required. The JSON document (`schemaVersion` 1) carrying what each check evaluates. The caller assembles it; this command collects nothing itself. |
| `--checks <a,b,c>` | Which checks to run. Defaults to all four. An unknown name is rejected rather than ignored. Selecting none exits `2`. |
| `--minimum-version <v>` | Hold this build to a floor higher than its own compiled one. A lower value is ignored, never applied. |
| `--declared-range <range>` | The range the calling repository declared for this package, checked against the minimum safe version. |
| `--format <text\|json>` | Output format. Defaults to `text`, which renders a table a CI job summary can display verbatim. |
| `--help` | Print usage and exit `0`. |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Every selected check evaluated and was satisfied. |
| `1` | Every selected check evaluated, and at least one found a real problem. |
| `2` | At least one check could not evaluate, **or** this build is below the minimum safe version, **or** the arguments themselves were unusable. |

`2` is not a variant of `1`. "Could not run" and "ran and failed" are
different facts, and a gate that reports clean after failing to run is worse
than no gate at all.

**There is no flag that turns a `2` into a `0`.** Whether a `2` blocks a merge
is a repository's own branch-protection decision, made in that repository. A
waiver here would launder one consumer's exception into every consumer at
once.

For the workflow a consuming repository adds, and the full inputs-document
shape, see
[`documents/caller-workflow.md`](documents/caller-workflow.md).

## The ternary

Every check returns `GateResult` from `@clossys/controller/gates`:

| Verdict | Meaning | Exit |
| --- | --- | --- |
| `satisfied` | Evaluated, and the condition holds. Carries a positive count of what was actually evaluated. | `0` |
| `violated` | Evaluated, and the condition does not hold. Carries at least one finding. | `1` |
| `indeterminate` | Could not evaluate. Carries a machine-readable reason drawn from that check's own declared vocabulary. | `2` |

A check can never construct a `satisfied` result while claiming to have
evaluated nothing — `gateSatisfied` refuses a zero count — and each check's
possible `indeterminate` reasons are declared as one array in its own source
rather than accumulating as ad hoc strings at call sites. Each check's test
suite asserts directly that no input engineered to produce no evaluation can
reach a `satisfied` verdict.

Folding is `indeterminate`-dominant: one check that could not evaluate makes
the whole run's answer "could not evaluate", even alongside a check that
found a real violation.

## The staleness floor

`MINIMUM_SAFE_VERSION` is compiled into each build, and `checkVersionFloor`
holds the running build to it. Being below the floor is `indeterminate` and
exits `2` — a hard failure, not a warning, because a warning is what every
existing shape already effectively offers and it demonstrably does not travel.

**The honest limit, stated rather than glossed:** a running build can only
compare against the floor *it* shipped with, so the compiled constant alone
can never fire on the old build that most needs it. What closes the loop is a
second, independent fact a current build genuinely can evaluate — the version
range the caller declared for this package in its own manifest, passed in via
`--declared-range`. A range whose lowest satisfiable version sits below the
floor means the caller's next lockfile refresh may resolve a build this one
already knows is unsafe, and that is reported as `indeterminate` too. A
caller's `--minimum-version` may raise the floor and never lower it, so a
caller's own CI can also tell an old build that it is old.

**On the rename:** `MINIMUM_SAFE_VERSION` is `0.1.0` here, unchanged from
`verify-standards`' own floor. It is not raised for the rename itself — the
floor exists for a released build that reported a passing verdict it should
not have, and moving files and a package name did not do that. Whether the
directory rename should reset the floor's *meaning* (an old caller pinned to
`@example/verify-standards` cannot resolve `@clossys/inspector`
at all, so the floor's own staleness signal cannot reach it through the
version-range mechanism this section describes) is noted in this package's
introducing pull request for a maintainer to decide; nothing here silently
assumes an answer either way.

## API

Everything is a pure function. The library performs no I/O at all in the
package root; the `inspector` executable reads exactly one caller-named file
through an injected port. (`./secret-scan` is the one part of this package
that does real I/O — see its own section below.)

### Orchestration

| Export | What it is |
| --- | --- |
| `verifyStandards` | Runs the floor and the selected checks, folds the results, returns a `VerifyStandardsReport` with an `exitCode`. |
| `VERIFY_STANDARDS_INPUTS_VERSION` | The inputs-document schema version this build reads. |
| `STANDARDS_CHECKS` | The four check names, in the order they are reported. |
| `inputsReasons` | The declared reasons the inputs document itself can be unreadable. |
| `selectionReasons` | The declared reason an empty check selection makes a run meaningless. |
| `VerifyStandardsInputs` | Type. The caller-assembled inputs document. |
| `VerifyStandardsOptions` | Type. How the run is configured, separately from what it reads. |
| `VerifyStandardsReport` | Type. Every row, the folded verdict, and the exit code. |
| `StandardsRowReport` | Type. One row: which row, its verdict, and a human-facing note. |
| `StandardsCheckName` | Type. One of the four checks. |
| `StandardsReportRow` | Type. A check name, or one of the run-level rows (`version-floor`, `inputs`, `check-selection`). |
| `CheckFinding` | Type. The one finding shape every check emits. |
| `StandardsFinding` | Type. A `CheckFinding` with the producing row attached. |

### The staleness floor

| Export | What it is |
| --- | --- |
| `MINIMUM_SAFE_VERSION` | The oldest build of this package whose behaviour is still trusted. |
| `checkVersionFloor` | Evaluates the floor. Never returns `violated` — being out of date is not a finding about the repository. |
| `versionFloorReasons` | The declared reasons the floor check can decline to vouch for a build. |
| `versionFloorFindings` | Renders a floor report's reason as findings, for a caller building its own output. |
| `parseVersion` | Parses an exact `major.minor.patch`. Returns `undefined` rather than guessing. |
| `compareVersions` | Orders two parsed versions; a prerelease sorts below the release it precedes. |
| `lowestSatisfyingVersion` | The lowest version a declared range can resolve to. A range it does not recognise returns `undefined`. |
| `ParsedVersion` | Type. A parsed version, with any prerelease tag kept for ordering. |
| `VersionFloorInput` | Type. Installed version, optional caller floor, optional declared range. |
| `VersionFloorReport` | Type. The verdict, the floor actually applied, and whether a lower caller floor was ignored. |
| `VersionFloorFinding` | Type. |

### Secret scan (the judge)

Evaluates a record of a scan *attempt*, never running a scanner itself.
"Attempted" is a separate field from every other, so a tool that died before
scanning cannot produce the same record a clean scan does. The record can
come from `./secret-scan`'s `attemptGitleaksScan`, below, or from anything
else a caller's own collection step produces in this shape.

| Export | What it is |
| --- | --- |
| `checkSecretScan` | Evaluates one scan attempt. |
| `secretScanReasons` | The declared reasons it can decline to answer. |
| `SecretScanObservation` | Type. Whether the scanner ran, which tool and version, its exit code, what it covered, and what it reported. |
| `SecretScanPolicy` | Type. Which exit codes mean "clean" and "findings" for this tool. |
| `SecretScanHit` | Type. One reported hit. Never the matched value. |
| `SecretScanScope` | Type. `full-history`, `commit-range`, or `working-tree`. |
| `SecretScanFinding` | Type. |
| `SecretScanReason` | Type. |

### Task record

Evaluates whether a change names a work item, in a shape that resolves. A
lookup that was never attempted, could not be made, or returned "not visible"
is `indeterminate` — a scoped credential answers identically for an item that
is absent and one it may not read. Structural exemptions (automation authors,
release-automation branches, declared labels) are first-class policy and are
named in the result rather than disappearing into a silent pass.

| Export | What it is |
| --- | --- |
| `checkTaskRecord` | Evaluates one change's task record against a consumer-owned policy. |
| `extractTaskReferenceText` | Pulls the first work-item reference out of a description. Caller labels are escaped, never spliced into a pattern. |
| `parseTaskReference` | Parses a reference into a scope and a number. Accepts a bare number, a qualified `owner/name#n`, and a tracker URL. |
| `taskRecordReasons` | The declared reasons it can decline to answer. |
| `TaskRecordObservation` | Type. Event kind, description, author, branch, labels, tracker scope, and the caller's lookup result. |
| `TaskRecordPolicy` | Type. Applicable events, exemption lists, record labels, and whether resolution is required. |
| `TaskRecordReport` | Type. The verdict, plus any exemption and parsed reference. |
| `TaskRecordExemption` | Type. Which exemption fired and what matched. |
| `TaskItemObservation` | Type. What the caller found out about the referenced item. |
| `TaskItemLookupOutcome` | Type. How the caller's lookup ended. |
| `TASK_ITEM_LOOKUP_OUTCOMES` | The same vocabulary as a value, so a caller-supplied outcome can be checked against it at runtime. An outcome outside it is `indeterminate`, never a resolved item. |
| `ParsedTaskReference` | Type. |
| `TaskRecordFinding` | Type. |
| `TaskRecordReason` | Type. |

### Review evidence

Delegates schema and policy validation to
`@clossys/controller/review`, then does the one thing that validator
deliberately does not: partitions its findings into "the change failed review"
and "the evidence could not be evaluated". The partition is a total mapping
over the rule union, so an upstream rule added without being classified is a
compile error rather than a silent default.

| Export | What it is |
| --- | --- |
| `checkReviewEvidence` | Evaluates an evidence bundle against a consumer-owned review policy. |
| `reviewEvidenceReasons` | The declared reasons it can decline to answer. |
| `ReviewEvidenceOptions` | Type. The commit under test, and whether review presence is required independently of the policy's verdict rules. |
| `ReviewEvidenceReport` | Type. The verdict, plus the distinct providers observed at head. |
| `ReviewEvidenceFinding` | Type. |
| `ReviewEvidenceReason` | Type. |

### Policy drift

Compares what a repository *declares* it enforces against what is *measured*
to be enforced, and refuses to let the first stand in for the second. An
unreadable or partially-read live state is `indeterminate` — permanently and
correctly so whenever the run's credential cannot read the enforcement
surface. Content-addressed policy documents are verified through
`@clossys/controller/policy` rather than by hashing anything here.

| Export | What it is |
| --- | --- |
| `checkPolicyDrift` | Compares a declared standard against a measured live state, and verifies any bound documents. |
| `policyDriftReasons` | The declared reasons it can decline to answer. |
| `PolicyDriftObservation` | Type. Declared requirements, measured live requirements, how they were measured and whether completely, and any bound documents. |
| `PolicyDriftOptions` | Type. Whether a live requirement nobody declared is acceptable. |
| `PolicyRequirement` | Type. One opaque requirement identifier. |
| `PolicyDocumentExpectation` | Type. A content-addressed binding plus the content materialized for this run. |
| `PolicyDriftReport` | Type. The verdict, plus how many things were actually compared. |
| `PolicyDriftFinding` | Type. |
| `PolicyDriftReason` | Type. |

### Command line

| Export | What it is |
| --- | --- |
| `main` | Runs the command and returns the exit code. Synchronous, and returns rather than exits. |
| `parseArgs` | Parses argv. Throws `CliInputError` for anything unusable. |
| `renderReport` | Renders a report as a table. Escapes pipes so a finding cannot break it. |
| `USAGE` | The usage text. |
| `CliInputError` | Error class for bad arguments. Always maps to exit `2`, never `1`. |
| `CliPort` | Type. The injected filesystem, output streams, and own-version resolver — the CLI's only contact with anything outside itself. |

## The `./secret-scan` subpath (the mechanism)

```ts
import {
  downloadAndVerifyGitleaks,
  getCachedGitleaksPath,
  resolveGitleaksRelease,
  attemptGitleaksScan,
  defaultGitleaksExecutor,
} from "@clossys/inspector/secret-scan";
```

Formerly the whole of `@example/secret-scan`. Two concerns, both
real I/O, both kept out of the judge above:

- **Verified acquisition** — download the `gitleaks` release asset for a
  version and platform, verify its SHA-256 against the checksum *the caller
  states*, extract it, and cache it. Unchanged from the standalone package:
  same functions, same shapes, same guarantees.
- **Running it** — new in this package (#283): `attemptGitleaksScan` runs
  the resolved binary through a caller-injected executor and translates
  gitleaks' own report into a `SecretScanObservation`, the exact shape
  `checkSecretScan` above evaluates. This is the wiring that lets a caller
  ask `inspector` to actually attempt a scan, rather than requiring every
  caller to hand-write that translation around a binary from somewhere else.
  The attested path is untouched: a caller who already has an observation
  from a different tool still gets a real verdict without touching this
  subpath at all.

| Export | What it is |
| --- | --- |
| `downloadAndVerifyGitleaks(options)` | Downloads the gitleaks release asset, verifies its SHA-256 checksum against `options.sha256`, extracts the binary, and caches it. Returns `{ path, version, verified }`. Throws on unknown version, an unusable `options.sha256` (see `assertUsableSha256`, checked before any network call), or checksum mismatch. |
| `getCachedGitleaksPath(version, cacheDir?)` | Returns the cached binary path if it exists, otherwise `undefined`. |
| `resolveGitleaksRelease(version)` | Returns this package's own recorded `GitleaksRelease` entry for a known version, or `undefined` — a lookup convenience, not the value verified against (see the export's own doc comment). |
| `getPlatformArch()` | Returns `{ platform, arch }` for the current process. |
| `getAssetName(version, platform, arch)` | Constructs the GitHub release asset filename for the given version/platform/arch. |
| `getKnownVersions()` | Returns an array of built-in known release versions. |
| `isWellFormedSha256(value)` | Type guard. `true` for exactly 64 lowercase hex characters — a syntax check, not a trust check. |
| `isKnownDegenerateSha256(value)` | `true` for a well-formed digest that still names no real asset: the SHA-256 of empty input, or an all-zero digest. |
| `assertUsableSha256(value, context)` | Throws (naming `context`) unless `value` is well-formed and not a known-degenerate digest. What `downloadAndVerifyGitleaks` and `KNOWN_RELEASES`'s own import-time check both use. |
| `EMPTY_INPUT_SHA256` | The well-known SHA-256 of empty input, as a constant — for comparison, and so this exact string appears in exactly one place in this package. |
| `ALL_ZERO_SHA256` | 64 `"0"` characters, as a constant. |
| `attemptGitleaksScan(options)` | Runs gitleaks through `options.execute` and returns a `SecretScanObservation` built from its report. `attempted` is always `true` in what it returns. |
| `defaultGitleaksExecutor` | A real `GitleaksExecutor` a caller may use as-is: spawns the binary, asks for a JSON report in a scratch directory, reads it back, cleans up. Not exercised by this package's own tests — see the hermetic-tests note below. |
| `GitleaksBinaryOptions` | Type. `{ version, sha256, cacheDir?, platform?, arch? }`. |
| `GitleaksBinaryResult` | Type. `{ path, version, verified }`. |
| `GitleaksRelease` | Type. `{ version, sha256, url }`. |
| `AttemptGitleaksScanOptions` | Type. `{ binaryPath, toolVersion, scope, unitsScanned, args, execute }`. |
| `GitleaksExecutor` | Type. `(binaryPath, args) => { exitCode, report }` — injected, never called for real in this package's tests. |
| `GitleaksRunResult` | Type. `{ exitCode, report }`. |

### Known releases

| Version | SHA-256 (linux x64, as recorded here) |
|---------|---------------------|
| 8.30.1 | `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` |

This is a lookup convenience for `resolveGitleaksRelease`, not the value
`downloadAndVerifyGitleaks` verifies against — that is always the caller's
own `options.sha256`. See `resolveGitleaksRelease`'s doc comment for why the
distinction matters, and revalidate this table against gitleaks' own
published checksums before leaning on it for a real download.

Every entry here is also checked, at import time, against
`assertUsableSha256` — malformed or one of the known-degenerate digests
(the SHA-256 of empty input, or an all-zero digest) throws immediately for
every consumer rather than shipping quietly. That check cannot see whether
an otherwise well-formed entry is *correct*, only whether it is the specific
shape of placeholder that has shipped here once already; revalidating
against gitleaks' own published checksums, by hand, before relying on this
table remains the caller's responsibility.

### Cache location

Binaries are cached in `$TMPDIR/vespeneventures/secret-scan/gitleaks/`
organized by `gitleaks-<version>-<platform>-<arch>/`. The cache is per-user
and survives across CI runs on self-hosted runners.

## What this package deliberately does not do

- **Compute its own escape rate, or any historical accuracy metric about
  itself.** See [Metric](#metric): that is `observer`'s job, computed from
  the outside, and this package has no mechanism for it on purpose.
- **Collect anything the judge evaluates.** No tracker is queried, no review
  provider is called, no enforcement surface is read. The caller collects;
  the judge decides. (`./secret-scan` is the one exception, and it is
  mechanism, not judgement — see [Composition](#composition).)
- **Hold a credential.** The judge needs none, because it calls nothing.
  `./secret-scan` needs none either: a GitHub release asset download needs no
  authentication.
- **Discover files.** The CLI reads exactly the one path a caller names.
- **Hold account values.** No owner, repository, label taxonomy, required
  context, or provider list. Requirements are opaque identifiers compared for
  equality.
- **Decide authority.** Whether any of this is required to merge is a
  per-repository branch-protection decision this package neither assumes nor
  encodes.

## Requirements

- Node 20 or newer.
- Runtime dependencies: `@clossys/controller` (`~0.9.0`) for the
  gate-result ternary, review-evidence validation, and (via its
  `./policy` subpath, the same single dependency, not a second one)
  content-addressed document verification, and — for the `./secret-scan`
  subpath only — `adm-zip` (`^0.6.0`, Windows archive extraction) and
  `tar` (`^7.5.22`, everywhere else).

## Licence

MIT. See [LICENSE](LICENSE).
