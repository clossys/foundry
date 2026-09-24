# RFC: qualify the exact tarball in the publish run, with provenance

- **Status:** draft, awaiting an owner decision. Documentation only: this file
  changes no code, workflow, gate or record.
- **Tracking issue:** #1425. Redesigns the machinery built for #948, and
  interacts with #833, #647 and #651.
- **Measured:** 2026-09-24, against `origin/main` at `3e03d9e3`. Every number
  below comes with the command that produced it, so it can be measured again.

## Summary

Today, publishing a version takes two separate qualification runs and a git
round trip between them. `qualify-candidate.yml` qualifies the version and
opens a pull request that commits a pre-publication record. After that pull
request merges, `publish.yml` qualifies the same version again and refuses to
upload unless the fresh result matches the committed record byte for byte.
The committed record binds the whole package tree hash, so any later edit to
the package makes it stale. A version that merged without a record needs a
deferral file.

This RFC proposes that the publish run **is** the qualification:

1. `publish.yml` packs once, qualifies that exact tarball on the pinned runtime
   in a credential-free job, reproduces it on a second runner, and hands the
   bytes to the environment-gated `publish` job by digest.
2. The upload goes out with `npm publish --provenance` through the existing
   trusted-publisher binding. The code already does this; see
   [Provenance is already on](#provenance-is-already-on).
3. The evidence becomes a committed record written **after** the upload. It
   extends the publication-evidence record that
   `record-publication-evidence.yml` already writes, and it never gates a
   publish. A GitHub artifact attestation over the tarball digest is optional.

The qualification bar does not move. Three things go away: the qualify pull
requests, the deferral files, and invalidation by tree hash. The one deviation
from #1425's wording is deliberate. Qualification runs in the publish **run**,
not in the publish **job**, because the job that holds `id-token: write` must
never execute third-party code (see [R1](#r1-credential-exposure)).

## 1. Problem

### 1.1 How it works today, end to end

| Step | Where | What it does |
| --- | --- | --- |
| a. Version bump merges | `ci.yml:1132-1147` (`qualification record required`, a required status check) | For each version bump, requires a retained, non-stale record or an issue-referenced deferral file (`scripts/check-qualification-record-required.mjs:1-16`, deferral rules `:62-80`). |
| b. Auto-dispatch | `.github/workflows/auto-qualify.yml:19-21, 54-83` | On every push to `main`, selects packages whose current version has no record and dispatches `qualify-candidate.yml` once per package. |
| c. Qualify | `.github/workflows/qualify-candidate.yml:128-136` (pinned runtime), `:167-184` (pack and run), `:214-232` (record) | Packs, runs `scripts/run-candidate-qualification.mjs` without credentials, writes `governance/release-qualifications/<stem>-<version>.json` through `scripts/generate-qualification-record.mjs`, which also proves the tarball reproduces from a clean rebuild (`:316-326`). |
| d. Deferral cleanup | `qualify-candidate.yml:240-244`, `scripts/remove-qualification-deferral.mjs` | Deletes the now-stale deferral file in a second commit (`:271-312` explains why it cannot share the record's commit). |
| e. Record PR | `qualify-candidate.yml:255-361` | Pushes `claude/qualify-<pkg>-<version>` and opens a pull request, which then goes through review, CI and the merge queue. |
| f. Record history gate | `ci.yml:1340-1392` (sharded `scripts/check-candidate-qualification.mjs`) | On every CI run, re-validates every retained record: its immutability, its single introduction commit, and joins recomputed at its reviewed commit (`scripts/lib/candidate-qualification.mjs:406-449`). |
| g. Publish preflight | `.github/workflows/publish.yml:136-149` | Before the environment gate, requires the record to exist and still match the current tree and manifest digests (`scripts/check-qualification-record-present.mjs:145-150`). |
| h. Qualify again | `publish.yml:185-465` | A credential-free `qualify` job on the pinned runtime (`:205-213`) packs (`:312-323`), runs the same runner (`:412-417`) and uploads `candidate.tgz` and `transcript.json` as an artifact (`:456-465`). |
| i. Publish | `publish.yml:467-705` | The job holds `environment: npm-publish` and `id-token: write` (`:476-483`). It runs the FULL safety gates (`:563-606`), then `validate-candidate-publish.mjs --mode prepublish` (`:617-622`), which requires the committed record (`scripts/validate-candidate-publish.mjs:64-69`) and a matching fresh transcript (`scripts/lib/candidate-qualification.mjs:615-623`). It re-hashes the tarball (`:624-640`) and uploads through `publish-qualified-directory.mjs --mode oidc` (`:642-673`). |
| j. Verify | `publish.yml:709-754` | Anonymously checks registry byte parity and the Sigstore/SLSA provenance. |
| k. Evidence | `.github/workflows/record-publication-evidence.yml`, `docs/PUBLISHING.md:1120` onward | After a successful `publish (<key>)` job, writes `governance/release-publications/later/<key>-<version>.json` into one rolling pull request. |

Steps c to f exist only to carry evidence from one GitHub-hosted run to
another through git. Step h already produces that evidence, on the same pinned
runtime, from the bytes that step i uploads.

### 1.2 Measured cost

| Measure | Value | Command |
| --- | --- | --- |
| Retained pre-publication records | 185 files (182 `pre-publication`, 3 `post-publication-bootstrap`), 2.2 MB, all `schemaVersion: 2` | `ls governance/release-qualifications/*.json \| wc -l`; `jq -r .schemaVersion …` |
| Records whose version was never published | 39 of the 181 files for `@clossys` names | registry comparison, script below |
| Deferral files | 72, citing #948 (55), #1250 (16) and #1212 (1) | `jq -r .issue governance/release-qualification-deferrals/*.json \| sort \| uniq -c` |
| Deferred versions superseded before they could be published | 53 of 72; the other 19 are the packages' current versions | manifest comparison |
| Deferred versions ever published | 0 | registry comparison |
| Pull requests that introduced record files | 56 merged PRs; 28 of them carried exactly one record | `git log --diff-filter=A -- governance/release-qualifications/` mapped through `gh api repos/clossys/foundry/commits/<sha>/pulls` |
| Automated per-version qualify PRs (`claude/qualify-<pkg>-<ver>`) | 31: 12 merged, 19 closed unmerged | `gh pr list --state all --limit 1500 --json headRefName,state` |
| Qualify PRs from one release fan-out | 18, opened between 22:02 and 22:05 UTC on 2026-09-23 after the release-batching merge (#1356-#1373). All 18 were closed as superseded about four hours later, because the next release bumps every package again. | same |
| Time from qualify PR open to merge (merged automated PRs) | median about 75 minutes; longest 5 hours 9 minutes (#1310) | `createdAt` and `mergedAt` from the same list |
| `qualify-candidate.yml` runs | 78 runs: 33 succeeded, 45 failed (26 in qualification, 17 pushing a branch that already existed, 2 in record generation). Successful runs had a median of 2.3 minutes. | `gh run list --workflow qualify-candidate.yml --limit 100`, failed steps from `gh run view <id> --json jobs` |
| Qualification runs per published version | at least 2: step c, then step h again | by construction |

Registry comparison: for each non-private package, fetch
`https://registry.npmjs.org/<name>` anonymously, then compare `versions`
against record and deferral versions. Scratch script, not committed.

### 1.3 Invalidation by tree hash, measured

A schema-2 record binds `packageTreeSha1 = git rev-parse <commit>:packages/<p>`
(`scripts/lib/candidate-qualification.mjs:482`), so it covers the whole
directory, tests included. The publish preflight compares it with the live tree
(`check-qualification-record-present.mjs:145-146`), and a record is immutable
once it is introduced. Any later merge that touches `packages/<p>`, even a
test-only change that `npm pack` would never ship, strands the recorded
version. Measured cases:

- **#1218** (designer 0.4.17): an unrelated merge (#1167) touched
  `packages/designer`, and the record went stale while its own PR was still in
  the merge queue. The PR was dropped from two merge trains and then closed;
  a fresh qualification was needed.
- **architect 0.1.7** (#920): a test-only fix moved the tree, and the version
  could never be published. `scripts/check-release-readiness.mjs:815-870` now
  carries dedicated logic just to report this state.
- **writer 0.3.18**: its deferral file says the previous version's record "went
  stale the moment its test suite changed". A new version was cut only to get a
  new record.
- Schema 3 (artifact-scoped digests, #879) would narrow the tree axis to the
  packed file set, but every retained file is schema 2.

### 1.4 What the cost buys

Every published version (142 of 142 on the registry) has a matching record, so
the join works. The cost does not come from the qualification bar. It comes
from moving qualification evidence through git **before** publishing, at a
commit other than the one being published.

## 2. What qualification must keep proving

These invariants hold today and must hold after the change, byte for byte.
The proposal is judged against this list.

- **I1. Exact bytes.** The tarball that is uploaded is the tarball that was
  qualified: equal SHA-1, SHA-256 and SHA-512
  (`publish.yml:624-640`), with clean-directory repack parity before upload
  (`scripts/publish-qualified-directory.mjs:374-381`).
- **I2. Pinned runtime.** Packing and qualification run on exactly Node
  `v24.19.0`, npm `11.17.0` and zlib `1.3.2.1-motley-3246f1b`
  (`scripts/lib/release-runtime.mjs:8-12`, asserted at `:38-46`, by
  `run-candidate-qualification.mjs:53`, and in each workflow). The pin is
  never relaxed.
- **I3. No inherited credentials.** The qualification process refuses an
  ambient `NODE_AUTH_TOKEN`, `NPM_TOKEN`, `GH_PACKAGES_TOKEN`, `GITHUB_TOKEN`
  or `GH_TOKEN` (`scripts/lib/candidate-runner.mjs:49-56`). The candidate's
  child processes get a literal environment and never the spread
  `process.env` (`:58-76`), with no CA-trust variable (#833, `:768-785`).
  The job that runs the candidate holds no registry-publish capability.
- **I4. Fixed operations, full coverage.** The fixed-operation runner checks
  install, uninstall and reinstall, every declared export, every bin's
  `--help`, the `0`/`1`/`2` exit cases and restoration, all against the policy,
  adapter and fixtures (`scripts/lib/candidate-qualification.mjs:506-598`).
  Stored commands are never executed.
- **I5. Source joins.** The evidence binds the package manifest, package tree,
  root `package.json` and lockfile, policy, adapter, fixture set and framework
  observations as they stand at the commit the tarball was built from
  (`currentQualificationJoins`, `:475-493`).
- **I6. Reproducibility.** The candidate reproduces from a clean rebuild of
  that commit (#893, `scripts/lib/artifact-reproducibility.mjs`, called from
  `generate-qualification-record.mjs:316-326`).
- **I7. Replay agreement.** Two independent qualification runs of the same
  bytes produce the same comparable transcript digest
  (`comparableTranscriptSha256`, compared at `candidate-qualification.mjs:622`).
  Today these are the step c and step h runs.
- **I8. Durable public record.** A reader with only a clone of this repository
  can find, for every published version, the qualification transcript, the
  joins and the tarball digests, and can re-derive the joins from git history
  without network access.
- **I9. Owner approval is spent only on qualified bytes.** Nothing requests the
  `npm-publish` approval until qualification has passed (#769).
- **I10. Provenance.** The registry holds a Sigstore/SLSA attestation binding
  the tarball to this repository, `publish.yml`, the source commit and the run.
  It is verified anonymously after upload (`publish.yml:737-754`).
- **I11. Fail closed.** A missing, invalid or indeterminate input stops the
  upload. It never degrades to a pass.

## 3. Proposal

### 3.1 Qualify in the publish run, not in the publish job

#1425 says "inside the publish job". Taken literally, that would place
third-party code in a job that holds `id-token: write` and the materialized
denylist. Qualification installs the candidate's dependency closure from the
public registry, then imports and runs it. `sanitizedEnv()` keeps credentials
out of the child's environment, but a child running as the same user on the
same runner can still read its parent's process environment from `/proc`.
That environment carries `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and
`ACTIONS_ID_TOKEN_REQUEST_URL` whenever the job has `id-token: write`. Those
two values are enough to mint an OIDC token for the npm trusted-publisher
exchange. `assertCredentialFree()` does not list them
(`candidate-runner.mjs:49`), because today they are never present where it runs.

The proposal therefore keeps the separation `publish.yml` already has: the
credential-free `qualify` job and the credentialed `publish` job
(`publish.yml:185-190` versus `:476-483`). Qualification moves into the same
run. It is no longer a git round trip, and the handoff between the two jobs is
anchored by digests that the qualification job cannot rewrite.

### 3.2 Job graph

```text
discover ── pack ──┬── qualify (leg A) ──┐
                   ├── qualify (leg B) ──┼── publish [env: npm-publish, id-token] ── verify-published
                   └── reproduce ────────┘                                            └─> record-publication-evidence (workflow_run)
```

- **`discover`** is unchanged except that the preflight at `:136-149`, which
  checks for a retained record, is removed. It still runs
  `check-release-catalog.mjs`.
- **`pack`** is new: `contents: read`, pinned runtime. It runs
  `npm ci --ignore-scripts`, the build, the lifecycle rehearsal
  (`publish.yml:306-310`), `npm pack --ignore-scripts`, and the launcher
  catalogue currency check (`:372-402`). It uploads `candidate.tgz` and emits
  its three digests as **job outputs**. The candidate's dependency closure is
  never installed or imported in this job, so no code that runs later in the
  run can rewrite these outputs.
- **`qualify` (two legs)** runs the current `qualify` job's replay steps as a
  two-leg matrix on separate runners: `contents: read`, no environment, no
  `id-token`, pinned runtime. Each leg downloads the artifact, refuses unless
  its digests equal the `pack` outputs, runs
  `run-candidate-qualification.mjs` and uploads its transcript. Two legs keep
  **I7** now that the committed record no longer supplies the second run.
- **`reproduce`** is new: `contents: read`, pinned runtime, fresh runner. It
  deletes every `dist/`, rebuilds from `github.sha`, packs, and emits digests
  as job outputs. This is **I6**, the check `generate-qualification-record.mjs`
  performs today, moved into the run.
- **`publish`** keeps `environment: npm-publish`, `id-token: write` and
  `contents: read`, as today. It installs nothing and runs no candidate code.
  Before and after the approval it:
  1. requires `pack`, `reproduce` and the downloaded artifact to agree on all
     three digests (**I1**, **I6**);
  2. validates both transcripts with the existing `checkTranscript` rules,
     requires their comparable digests to be equal and their tarball fields to
     equal the digests (**I4**, **I7**);
  3. computes `currentQualificationJoins(root, candidate, github.sha)` from git
     and checks the transcripts against the policy-derived archetypes,
     dimensions and framework observations (**I5**);
  4. runs the FULL safety, collision, README parity, contamination and
     artifact-safety gates on the exact tarball (unchanged, `:545-615`);
  5. calls `publish-qualified-directory.mjs --mode oidc`, which is changed
     to accept this in-run evidence in place of a committed record path
     (`:318-328`). Clean-directory repack parity and `--provenance` stay as
     they are.
- **`verify-published`** is unchanged.
- **`record-publication-evidence.yml`** writes the durable record
  ([3.4](#34-evidence-attestation-release-asset-or-git-record)).

The approval (**I9**) is still requested only when the `publish` job starts,
which is after every qualification, reproduction and join job has passed. The
approver can read their results in the same run before approving. Today the
approver is looking at a record that was reviewed hours or days earlier, at
another commit.

### 3.3 Provenance is already on

`publish-qualified-directory.mjs:391` already runs
`npm publish . --provenance --access public --ignore-scripts` in OIDC mode.
`publish.yml:737-754` already verifies the Sigstore/SLSA attestation
anonymously. Every OIDC upload goes through the trusted-publisher binding
shape recorded in #647: repository `clossys/foundry`, workflow `publish.yml`,
environment `npm-publish`. The owner connects that binding per package after
the package's first identity is published. **This RFC changes nothing about
provenance or the binding.** What changes is that provenance now points at the same run that
qualified the bytes, not at a run that compared them to a committed record.
The provenance's `invocationId` identifies the run. The evidence record
([3.4](#34-evidence-attestation-release-asset-or-git-record)) connects that
run's qualify-job IDs and transcript digests to the same tarball digest. The
existing `verifyPublicationProvenance`
(`scripts/lib/publication-evidence-run.mjs`) already cross-checks run and
attempt against the attestation.

A package's first identity still goes through the owner-present path
(`docs/PUBLISHING.md`, "Owner-present first publication, then OIDC"), because
npm cannot bind a trusted publisher to a name that does not exist yet. That
path's `publish-qualified-set.mjs` has to switch to the same in-run evidence.
See the migration, phase 4.

### 3.4 Evidence: attestation, release asset or git record

| Carrier | Durable | Readable offline from a clone | Tamper-evident | New permission |
| --- | --- | --- | --- | --- |
| Actions artifact (exists today) | No: retention-limited, and the artifact URL already embedded in later-publication records will expire | No | Digest only | None |
| GitHub release asset per `pkg@version` | Yes | No | No: assets can be replaced | `contents: write` in the publish workflow |
| GitHub artifact attestation (`actions/attest`, subject = tarball SHA-256, predicate = canonical transcript) | Yes | No: needs the attestation API or Sigstore | Yes, signed by the workflow identity | `id-token: write` and `attestations: write`, in a separate job |
| Committed record written after publish | Yes | **Yes** | Git history plus a join to npm provenance | None new: `record-publication-evidence.yml` already holds `contents: write` and `pull-requests: write` under a recorded owner decision |

**A git record is still needed.** Only a committed record meets **I8**. The
lifecycle contract derives package state from evidence in the tree
(`docs/LIFECYCLE.md`), and `check-package-evidence.mjs`,
`check-later-publications.mjs` and the release-readiness publication lookup
all read git. Artifacts expire. Release assets can be replaced and need write
permission in the publish workflow. Attestations need network access to
verify. What changes is **when** the record is written and **what it gates**:

- It is written **after** a successful upload, by the existing
  `record-publication-evidence.yml`. That workflow already adds records to one
  rolling pull request instead of opening one per version (the
  `select_candidate_branch` logic in that file), and it never gains
  `id-token: write`.
- It gates nothing about publishing. A missing record is found by a sweep,
  never by blocking a merge, because by then the version is immutably public
  and writing the record is then the sole remedy.
- It is self-contained. A new record kind (working name
  `foundry-run-qualified-publication-v1`) embeds everything in today's
  later-publication record: registry proof, provenance and run, job and
  artifact bindings. It adds the two full canonical transcripts and the joins
  from 3.2 step 3, which today live only in the pre-publication record. A clone
  can then re-derive every join at `publicationSource.sha` without the network
  (**I8**).

**Attestation is optional (recommended as a later phase, not as a
prerequisite).** An `attest` job after both `qualify` legs and before
`publish` would give a signature over the transcript itself, so a third party
could check the qualification claim without trusting this repository's git
history. It needs `id-token: write` in a job that runs no candidate code and
has no `npm-publish` environment. Before enabling it, test that a token minted
outside the environment is rejected by the #647 binding. See decision D5.

## 4. What changes

| Item | Change |
| --- | --- |
| `.github/workflows/qualify-candidate.yml` | **Removed** after cutover. Until then, a diagnostic dispatch that uploads its transcript as an artifact and opens no pull request may stay if the owner wants one (decision D6). |
| `.github/workflows/auto-qualify.yml`, `scripts/select-unqualified-packages.mjs`, `scripts/filter-qualification-dispatch.mjs` | **Removed.** Nothing is left to dispatch. |
| `scripts/generate-qualification-record.mjs` | **Retired.** Its reproducibility check moves to the `reproduce` job, and its join derivation already lives in `currentQualificationJoins`. |
| `scripts/check-qualification-record-present.mjs` and the `publish.yml:136-149` preflight | **Removed.** Nothing is left to go stale before publish. |
| `scripts/check-qualification-record-required.mjs` and the required context `qualification record required (version bump vs. retained record)` | **Removed.** Needs an owner ruleset change (decision D3). Until then the job must keep reporting under that exact name (made report-only), or every merge blocks. |
| `governance/release-qualification-deferrals/` (72 files), `scripts/remove-qualification-deferral.mjs`, `scripts/check-qualification-deferral-issues.mjs`, `.github/workflows/qualification-deferral-sweep.yml` | **Removed.** "Merged, not yet published" becomes an ordinary state that `npm run publish:plan` reports. It needs no acknowledgement, because nothing claims it was qualified. |
| `governance/release-qualifications/` (185 files) and `scripts/check-candidate-qualification.mjs` | **Kept, frozen.** The existing records remain valid historical evidence under their own schemas. A new rule refuses any file added after the cutover commit. This fits the sealed-predecessor model already there (`candidate-qualification.mjs:421-449`). |
| `scripts/check-release-readiness.mjs` stale-record logic (`:815-870`) | **Simplified.** It stays as it is for historical versions. For versions after the cutover there is no record to go stale. |
| `scripts/validate-candidate-publish.mjs` | **Changed.** Gains an in-run mode: joins at `github.sha`, two transcripts, digests from job outputs. `bootstrap` mode for `verify_only` is kept. |
| `scripts/publish-qualified-directory.mjs` | **Changed.** `exactRecord` (`:318-328`) accepts in-run evidence. Nothing else changes: runtime assertion, staged FULL scan, repack parity, `--provenance`, post-publish verification. |
| `.github/workflows/publish.yml` | **Changed** as in 3.2. The `npm-publish` environment, `id-token: write` scope, per-package concurrency group (`:63-72`), `refs/heads/main` restriction (`:475`), `dry_run` and `verify_only` inputs are all **kept**. |
| `record-publication-evidence.yml`, `scripts/lib/publication-evidence-run.mjs` | **Changed.** Writes the new self-contained record kind. Permissions unchanged. |
| `scripts/lib/release-runtime.mjs`, `scripts/lib/candidate-runner.mjs` | **Kept unchanged.** `assertCredentialFree()` may additionally refuse `ACTIONS_ID_TOKEN_REQUEST_TOKEN` as defence in depth (decision D4). |
| `docs/PUBLISHING.md` (sections at `:337`, `:416`, `:463`, `:913`), `docs/RELEASING.md:532-537`, `AGENTS.md` "Cloud sessions" | **Rewritten** to describe the in-run model, in the same pull request as each behaviour change. |

**Deferrals.** All 72 deferrals become moot at once. The 53 superseded versions
will never be published under either design. The 19 current versions become
publishable by dispatching `publish.yml`, with no record pull request in
between.

**#948.** Its cause is that the pinned runtime is not on the developer machine,
and that stops mattering: qualification never has to run on a developer
machine to publish. #948 closes as superseded when phase 3 lands. Its "worth
deciding" question, about where the pin is documented, is answered by the pin
living only in the workflow that uses it.

**#833.** The cloud-sandbox CA-trust problem stops mattering for releases.
Release qualification runs only on GitHub-hosted runners, which reach
`registry.npmjs.org` without interception. `sanitizedEnv()` stays a literal
with no CA-trust variable, and the "not this repository's call to make
unilaterally" position in `AGENTS.md` is kept unchanged. A cloud session can
still run the runner for diagnosis, but no release depends on it.

**Owner approval.** Nothing about the `npm-publish` environment moves. It is
still the one job that can upload, it still requires the configured reviewer,
and it is still reached only after every qualification job has passed.
Publishing still requires a human dispatch (`publish.yml:3-6`).

## 5. Risks and mitigations

### R1. Credential exposure

- *Risk.* A compromised transitive dependency, run during qualification, gains
  a publish capability. Or it forges a passing transcript, or swaps the
  tarball.
- *Mitigation.* Qualification never shares a job with `id-token: write`, the
  environment or the denylist (3.1). The tarball digests come from `pack`
  outputs, set in a job that never installs the candidate's closure. A leg that
  tampers with its own files cannot change them, and cannot make `reproduce`
  agree. A forged transcript has to match an independent leg's comparable
  digest, which is the same bar as today, where the committed record plays the
  second leg. `permissions` stays at `contents: read` everywhere except
  `publish` (and the optional `attest` job).
- *Residual.* A build-toolchain compromise that behaves the same way in `pack`,
  `reproduce` and both legs is out of scope for both designs. Today's record is
  produced by the same build. The lockfile and npm provenance are the controls
  for that class.

### R2. Reproducibility

- *Risk.* Without a committed record, nothing outside the run anchors the
  bytes.
- *Mitigation.* The anchor becomes agreement between two runners (`pack` and
  `reproduce`) on the pinned runtime, which is strictly stronger than today's
  single `generate-qualification-record.mjs` rebuild. The published bytes are
  then pinned permanently by npm's integrity field and the provenance
  statement. The evidence record carries both.

### R3. Failure after partial publish

- *Risk.* An upload succeeds, then a later step fails.
- *Mitigation.* `npm publish` of one version is atomic, and the matrix is one
  package per dispatch (`publish.yml:103-105`). Verification that runs out of
  time is already treated as indeterminate, never as failure (`:665-673`,
  #790). The evidence workflow keys on the `publish (<key>)` job's own
  conclusion, so a later failure never loses the record. A multi-package
  release is a sequence of dispatches in runtime-dependency order
  (`docs/PUBLISHING.md`, "Runtime dependency order"). If a dependent fails
  after its dependencies are live, the fix is a forward version, the same as
  today. A dependent that currently has to wait for its dependencies to publish
  before it can even be qualified and recorded now just dispatches after them.

### R4. Offline audit

- *Risk.* Evidence lives in systems a clone cannot see.
- *Mitigation.* The self-contained post-publish record (3.4). A sweep
  (extending `check-later-publications.mjs`) fails when a registry version has
  no record, so a lost `workflow_run` still becomes visible. Sigstore signature
  verification still needs the network, the same as today.

### R5. Cloud sandboxes (#833)

- *Risk.* Agents lose the ability to produce release evidence.
- *Mitigation.* They cannot produce it today either. After the change, nothing
  in the release path needs a sandbox. Cloud sessions still get no denylist and
  no publish credentials (`AGENTS.md`, "Cloud sessions").

### R6. Rollback

- *Risk.* The published version is bad.
- *Mitigation.* This is unchanged by the proposal. npm versions are immutable,
  and unpublish is time-limited (#651 measured it closing at 72 hours). The
  remedy is deprecation plus a forward version.
- *Risk.* The migration itself goes wrong.
- *Mitigation.* Each phase below is one revertible pull request. The
  record-based path stays callable until phase 5, so reverting a phase restores
  the previous behaviour without rewriting history.

### R7. Wasted approvals

- *Risk.* A flaky qualification leg fails after dispatch.
- *Mitigation.* No approval is spent until all legs pass (**I9**). A rerun of
  the failed job does not re-request approval that was never granted.

### R8. Loss of pre-merge signal

- *Risk.* Today a broken candidate is found when the record PR fails, before
  the owner dispatches a publish.
- *Mitigation.* `publish.yml` with `dry_run: true` runs the complete new graph
  except the upload, and can be dispatched at any time, for example
  automatically after the release PR merges, as a report with no PR. `ci.yml`
  still packs and round-trips every package on every change.

## 6. Alternatives considered

**A. Keep qualify PRs, but one per release.** One dispatch qualifies every
package that the release bumped and opens a single PR. PRs per release drop
from N to 1, but four costs remain: tree-hash invalidation (any merge between
the qualify PR and the publish still strands versions, as #1218 did),
deferrals, the double qualification, and the record-before-publish ordering.
Dependents still cannot qualify until their dependencies are live, so a
release with runtime edges still needs more than one PR. This cuts PR count
but leaves every other cost in place.

**B. Qualify on the release PR branch before merge.** The record lands in the
same PR as the version bump, so it is never behind. But the record binds the
PR head, and the squash or merge-queue commit is different, so the join has to
be squash-tolerant, as `docs/PUBLISHING.md:374-380` already describes. Any
merge queued ahead touching the same package invalidates it inside the queue:
the #1218 failure, moved earlier. `docs/PUBLISHING.md:379-380` explicitly
defers PR-side qualification "so untrusted PR code never receives publish
credentials". Running qualification on PR code in a trusted context is exactly
the boundary that deferral protects. Dependents still cannot qualify before
their dependencies publish, and deferrals remain for anything that merges
without a record.

**C. This proposal.** Qualify the exact bytes in the publish run, in
credential-free jobs, with two-leg replay and an independent rebuild. Upload
with the provenance already in place, and write the durable record afterwards.

**Recommendation: C.** Of the three, it alone removes the stale-record
class instead of shrinking it. It also qualifies the bytes that are actually
uploaded, at the commit they are built from, and it moves the approval to the
point where the approver can see this run's qualification. Every invariant in
section 2 is kept. I7 moves from "record against fresh run" to "leg A against
leg B". I8 moves from a pre-publication record to a post-publication one.

## 7. Migration plan

Each phase is one pull request, can be reverted alone, and leaves `main`
publishable.

1. **Add the in-run graph behind a switch.** Add `pack`, the two-leg `qualify`,
   `reproduce` and the in-run validation mode to `publish.yml`, selected by a
   new `workflow_dispatch` input `evidence: record | in-run` that defaults to
   `record`. The record path is untouched. Revert: drop the input.
2. **Rehearse.** Dispatch `evidence: in-run, dry_run: true` for every package,
   and `verify_only: true` for published ones. Keep the run URLs and the
   measured leg-agreement results in #1425. No upload happens.
3. **First in-run publish.** Publish one current deferred version (a leaf
   package with no first-party runtime dependents) with `evidence: in-run`,
   through the unchanged `npm-publish` approval. Extend
   `record-publication-evidence.yml` to write the new record kind for it.
   Confirm the anonymous provenance and registry-parity jobs are green. Revert:
   switch back to `record` for later dispatches. The version stays published
   either way.
4. **Make `in-run` the default and cover first identities.** Switch the
   default, and move `publish-qualified-set.mjs` (owner-present) to the same
   evidence. Make `qualification record required` report-only while keeping
   its context name. Stop `auto-qualify.yml`. #948 is closed as superseded
   here.
5. **Remove the record path.** After the owner removes the required context
   (decision D3): delete the qualify workflows, the deferral store, the sweep
   and the dead scripts listed in section 4, and freeze
   `governance/release-qualifications/`. Rewrite `docs/PUBLISHING.md`,
   `docs/RELEASING.md` and the `AGENTS.md` #833 paragraph.
6. **Optional: attestation.** Add the `attest` job (decision D5).

### Decisions needed from the owner

- **D1. Adopt proposal C** as the release-qualification model, replacing
  per-version qualify PRs. The alternatives are A and B.
- **D2. Accept "publish run, separate credential-free job"** as the meaning of
  #1425's "inside the publish job", for the reason given in section 3.1.
- **D3. Remove `qualification record required (version bump vs. retained
  record)` from the `main` branch ruleset's required checks** at phase 5. Only
  the owner can change the ruleset.
- **D4. Extend `assertCredentialFree()`** to also refuse
  `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, as defence in depth. This is a change to a
  deliberately strict boundary, so it is the owner's call.
- **D5. Evidence carriers:** the committed post-publish record only
  (recommended), or with a GitHub artifact attestation as well (phase 6, adds
  `attestations: write` and `id-token: write` in a job without the
  environment). Release assets are not recommended.
- **D6. Diagnostic qualification dispatch:** delete `qualify-candidate.yml`
  outright at phase 5, or keep a PR-less, artifact-only diagnostic variant.
- **D7. Deferred versions:** confirm that the 53 superseded deferred versions
  are abandoned (never published). Their deferral files are deleted, and the
  19 current versions are published through the new path in ordinary release
  order.
- **D8. Record location:** write the new record kind under the existing
  `governance/release-publications/later/`, one file per published version
  (recommended), or in a new directory.
