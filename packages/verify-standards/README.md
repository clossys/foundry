# @vespeneventures/verify-standards

One repository-standards gate, shipped as a package so that a fix reaches
every consumer through the same dependency machinery every other real
dependency already uses.

Four checks are bundled — a secret-scan attempt, a change's task record, its
review evidence, and drift between a declared standard and the live state
enforcing it. Every check is a pure function of observations the caller
collected, every check reports `satisfied` / `violated` / `indeterminate`
rather than a boolean, and the run folds to a `0` / `1` / `2` exit code that
nothing can override.

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

## Install

```bash
npm install --save-dev @vespeneventures/verify-standards
```

The package is published to GitHub Packages, so a consuming project needs the
scope pointed at that registry and an authenticated `NODE_AUTH_TOKEN` before
installing — the same setup every other package in this scope already needs.

```ts
import { verifyStandards, checkSecretScan } from "@vespeneventures/verify-standards";
```

## Use it as a command

```bash
verify-standards --inputs verify-inputs.json --declared-range "^0.1.0"
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

Every check returns `GateResult` from `@vespeneventures/governance/gates`:

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

## API

Everything is a pure function. The library performs no I/O at all; the
`verify-standards` executable reads exactly one caller-named file through an
injected port.

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

### Secret scan

Evaluates a record of a scan *attempt*, never running a scanner itself.
"Attempted" is a separate field from every other, so a tool that died before
scanning cannot produce the same record a clean scan does.

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
`@vespeneventures/governance/review`, then does the one thing that validator
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
`@vespeneventures/policy` rather than by hashing anything here.

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

## What this package deliberately does not do

- **Collect anything.** No scanner is downloaded or run, no tracker is
  queried, no enforcement surface is read. The caller collects; this decides.
- **Hold a credential.** It needs none, because it calls nothing.
- **Discover files.** It reads exactly the one path a caller names.
- **Hold account values.** No owner, repository, label taxonomy, required
  context, or provider list. Requirements are opaque identifiers compared for
  equality.
- **Decide authority.** Whether any of this is required to merge is a
  per-repository branch-protection decision this package neither assumes nor
  encodes.

## Requirements

- Node 20 or newer.
- Two runtime dependencies: `@vespeneventures/governance` (pinned `~0.14.0`)
  for the gate-result ternary and review-evidence validation, and
  `@vespeneventures/policy` (pinned `~0.1.0`) for content-addressed document
  verification.

## Licence

MIT. See [LICENSE](LICENSE).
