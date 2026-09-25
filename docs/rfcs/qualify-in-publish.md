# RFC: one release run at the release commit, qualifying the exact tarballs

- **Status:** Accepted 2026-09-24. The owner accepted every recommendation;
  see [Decisions (recorded 2026-09-24)](#8-decisions-recorded-2026-09-24).
  Documentation only: this file changes no code, workflow, gate or record
  until the migration phases in [section 7](#7-migration-plan) land. Each
  phase there lands as its own pull request.
- **Tracking issue:** #1425. Redesigns the machinery built for #948, and
  interacts with #833, #647 and #651.
- **Measured:** 2026-09-24. File and line citations are against `origin/main`
  at `33891d02`. Registry figures come from anonymous reads of
  `https://registry.npmjs.org/` on the same day. Each figure names what it
  counts and the command that produced it.

## Summary

There is no release object today. Evidence is made per package, bound to a
moving source tree and to the public registry, and carried to publish through
its own pull request. One release therefore becomes N serial pull-request
round trips.

The decided target makes the merged release commit **the** release:

1. A protected tag `release/<date>` marks the release pull request's merge
   commit. `publish.yml` runs on that tag without a manual dispatch.
2. That one run packs every bumped package once and qualifies each exact
   tarball in credential-free jobs. A dependent is installed against its
   siblings' candidate tarballs, not the registry.
3. The run takes **one** `npm-publish` approval for the whole set, then uploads
   in dependency order with `npm publish --provenance`.
4. The durable proof is one self-contained git record per version, written
   **after** upload under `governance/release-publications/later/`. A
   per-release evidence pull request carries the records and merges on a
   required mechanical re-derivation check.

An earlier draft of this RFC (qualify in the publish run, write the record
after upload) is **phase 1** of this design, not its end state. The
qualification bar does not move. Qualification still runs in a separate job
from the one that holds `id-token: write` (D2).

## 1. Problem

### 1.1 How it works today, end to end

| Step | Where | What it does |
| --- | --- | --- |
| a. Version bump merges | `ci.yml:1213-1239` (`qualification record required`, a required status check) | For each version bump, requires a retained, non-stale record or an issue-referenced deferral file (`scripts/check-qualification-record-required.mjs:1-16`, deferral rules from `:62`). |
| b. Auto-dispatch | `.github/workflows/auto-qualify.yml:19-21, 54-83` | On every push to `main`, selects packages whose current version has no record and dispatches `qualify-candidate.yml` once per package. |
| c. Qualify | `.github/workflows/qualify-candidate.yml:167-184` (pack and run), `:214-232` (record) | Packs, runs `scripts/run-candidate-qualification.mjs` without credentials, and writes `governance/release-qualifications/<stem>-<version>.json` through `scripts/generate-qualification-record.mjs`, which also proves the tarball reproduces from a clean rebuild (`:320-326`). |
| d. Deferral cleanup | `qualify-candidate.yml:240-244`, `scripts/remove-qualification-deferral.mjs` | Deletes the now-stale deferral file in a second commit. |
| e. Record PR | `qualify-candidate.yml:255-361` | Pushes `claude/qualify-<pkg>-<version>` and opens a pull request, which then goes through review, CI and the merge queue. |
| f. Record history gate | `ci.yml:1479-1542` (sharded `scripts/check-candidate-qualification.mjs`), fan-in `:1543` | On every CI run, re-validates every retained record: immutability, single introduction commit, and joins recomputed at the reviewed commit. |
| g. Publish preflight | `.github/workflows/publish.yml:136-149` | Requires the record to exist and still match the current tree and manifest digests (`scripts/check-qualification-record-present.mjs:145-150`). |
| h. Qualify again | `publish.yml:185-465` | A credential-free `qualify` job re-walks every record's history (`:276-285`, the call at `:282`), packs (`:312`), runs the same runner (`:412`) and uploads the candidate and transcript (`:456`). |
| i. Publish | `publish.yml:467-705` | Holds `environment: npm-publish` and `id-token: write` (`:478`, `:483`). Runs the FULL gates (`:563-611`), validates against the committed record (`:617-622`), re-hashes the tarball (`:624-640`) and uploads (`:642-673`). |
| j. Verify | `publish.yml:709-754` | Anonymously checks registry byte parity and the Sigstore/SLSA provenance (`:737`). |
| k. Evidence | `.github/workflows/record-publication-evidence.yml`, `docs/PUBLISHING.md:1131` onward | After a successful `publish (<key>)` job, writes `governance/release-publications/later/<key>-<version>.json` into one rolling pull request. |

`publish.yml` runs only from `refs/heads/main` (`:475`) and builds whatever
`main` holds at dispatch. Its header says so: a merged bump is not a release
until someone dispatches it (`:3-6`, #757).

### 1.2 Measured stock

| Measure | Value | What it counts | Command |
| --- | --- | --- | --- |
| Retained pre-publication records | 192 files: 189 `pre-publication`, 3 `post-publication-bootstrap`; all `schemaVersion: 2`; 2.0 MB of blob bytes | every `.json` under `governance/release-qualifications/` | `git ls-tree -r -l origin/main governance/release-qualifications/`; `jq -r .timing` |
| Records for versions never published | 39 of 188 | records whose `candidate.name` is `@clossys/*`, compared with the registry's `versions` | registry comparison, below |
| Published versions with a record | 149 of 149 | every version on the registry for every non-private package | same |
| Deferral files | 86: #948 (69), #1250 (16), #1212 (1) | every `.json` under `governance/release-qualification-deferrals/` | `jq -r .issue … \| sort \| uniq -c` |
| Deferred versions superseded | 72 of 86 | deferral `version` differs from the package's current manifest version | manifest comparison |
| Deferred versions still current | 14 of 86 | deferral `version` equals the manifest version; all 14 are bumps from the 2026-09-24 release that did not ship | same |
| Deferred versions ever published | 0 of 86 | registry comparison | same |
| Automated qualify PRs (`claude/qualify-<pkg>-<ver>`) | 50: 17 merged, 19 closed unmerged, 14 open | all time | `gh pr list --state all --limit 1500 --json headRefName,state` |
| `qualify-candidate.yml` runs | 108: 54 succeeded, 54 failed | all time | `gh run list --workflow qualify-candidate.yml --limit 300` |
| Qualification runs per published version | at least 2 (steps c and h) | by construction | |

Registry comparison: for each non-private package, fetch
`https://registry.npmjs.org/<name>` anonymously and compare `versions` with
record and deferral versions. Scratch script, not committed.

The superseded and still-current deferral counts above are a point-in-time
observation, dated to this measurement (2026-09-24). They are not the
decision: the rule (3.6, D7, R9) is to publish every deferral still current
and abandon every deferral superseded, whatever the current counts are. The
first cohort run re-derives which deferrals are current from the manifest
at run time, not from this count.

### 1.3 The 2026-09-24 release, measured

The release pull request #1438 bumped 21 package versions. Seven shipped that day.

| Measure | Value | What it counts |
| --- | --- | --- |
| Wall clock | 5 h 04 min end to end; 3 h 56 min after merge | from dispatching `release-pr.yml` (15:59:37 UTC) to the last upload finishing (21:04:05); the second figure starts at the #1438 merge |
| Critical path after merge | 236 min: 119 (50%) evidence PR round trips, 53 (22%) waiting for approvals, 50 (21%) re-walking record history, under 15 qualifying and uploading | controller, then publisher, the longest dependency chain |
| The qualification itself | 3 seconds | the writer run's `Run fixed candidate qualification credential-free` step |
| History re-walk inside publish | 21 to 29 min per run, 154.6 min over 6 runs | the `check:candidate-qualification` call at `publish.yml:282`, which already passed as a required check on the same commit |
| Dependent qualification failures | 26, all `ETARGET` | publisher's `qualify-candidate.yml` runs that day; it depends on sibling versions that were not yet on the registry. It first passed after controller 0.9.23 went live |
| Owner acts | about 69 | every owner-authority timeline event: dispatches, hand commits, labels, close and reopen, review comments, auto-merge toggles, approvals, the owner-present publish. About 35 distinct initiated acts |
| Executed jobs | 921, of which 699 in `ci.yml` | every job that ran in any workflow between 15:55 and 21:10 UTC and belongs to the release. Overnight qualify runs are not included |
| Bot-opened PRs needing a close and reopen before CI ran | 7 | the qualify PRs that shipped (#1477) |

### 1.4 Invalidation by tree hash

A schema-2 record binds `packageTreeSha1 = git rev-parse <commit>:packages/<p>`
(`scripts/lib/candidate-qualification.mjs:482`), so it covers the whole
directory, tests included. The publish preflight compares it with the live
tree (`check-qualification-record-present.mjs:145-146`). A record is immutable
once introduced. Any later merge that touches `packages/<p>`, even a
test-only change that `npm pack` never ships, strands the recorded version.

- **#1218** (designer 0.4.17): an unrelated merge (#1167) touched
  `packages/designer`, and the record went stale in the merge queue.
- **architect 0.1.7** (#920): a test-only fix moved the tree, and the version
  could never be published.
- **writer 0.3.18**: its deferral says the previous record went stale when its
  test suite changed. A new version was cut only to get a new record.

### 1.5 Root causes

| Cause | Evidence |
| --- | --- |
| Evidence travels as a git pull request **before** publish, so machine data pays the full cost of human code review. | Steps c to f. 119 of 236 critical-path minutes (1.3). |
| There is no release object. Publish builds `main` at dispatch, so any later merge can change what ships. | `publish.yml:475`. The merge queue batches up to 5 entries (ruleset `max_entries_to_merge: 5`): #1388's merge commit `246161d3` got a `merge_group` run but no `push` run, and `main`'s next push run was for `659a8c83`. So `github.sha` on push is not reliably the release commit. The weekend merge freeze (`docs/RELEASING.md:516-549`) exists to cover this. |
| Dependents are qualified against the public registry, so a release with runtime edges runs in serial rounds. | `scripts/lib/candidate-runner.mjs:58-76`, `:874`. 26 `ETARGET` failures (1.3). |
| Bumping is decoupled from shipping. | #1438 bumped 21 and shipped 7. 86 deferrals, 0 ever published (1.2). |
| Verification is repeated, and its cost grows with history. | 1.3, history re-walk row. |

## 2. What qualification must keep proving

These invariants hold today and must hold after every phase.

- **I1. Exact bytes.** The uploaded tarball is the qualified tarball: equal
  SHA-1, SHA-256 and SHA-512 (`publish.yml:624-640`), with clean-directory
  repack parity before upload (`scripts/publish-qualified-directory.mjs:374-381`).
- **I2. Pinned runtime.** Packing and qualification run on exactly Node
  `v24.19.0`, npm `11.17.0` and zlib `1.3.2.1-motley-3246f1b`
  (`scripts/lib/release-runtime.mjs:8-12`, asserted at `:38-46` and by
  `run-candidate-qualification.mjs:53`). The pin is never relaxed.
- **I3. No inherited credentials.** The candidate's child processes get a
  literal environment, never the spread `process.env`
  (`scripts/lib/candidate-runner.mjs:58-76`), with no CA-trust variable
  (#833). The job that runs the candidate holds no publish capability.
- **I4. Fixed operations, full coverage.** Install, uninstall and reinstall,
  every declared export, every bin's `--help`, the `0`/`1`/`2` exit cases and
  restoration, against the policy, adapter and fixtures
  (`checkTranscript`, `candidate-qualification.mjs:506` onward). Stored
  commands are never executed.
- **I5. Source joins.** The evidence binds the manifest, package tree, root
  `package.json` and lockfile, policy, adapter, fixtures and framework
  observations at the commit the tarball was built from
  (`currentQualificationJoins`, `:475-493`).
- **I6. Reproducibility.** The candidate reproduces from a clean rebuild of
  that commit (#893, `scripts/lib/artifact-reproducibility.mjs`).
- **I7. Replay agreement.** Two qualification runs of the same bytes produce
  the same comparable transcript digest (`comparableTranscriptSha256`,
  `:622`). This catches nondeterminism. It is not a tamper control: both runs
  execute the same candidate.
- **I8. Durable public record.** From a clone alone, a reader can find the
  transcript, joins and digests for every published version and re-derive the
  joins without network access.
- **I9. Approval is spent only on qualified bytes.** Nothing requests the
  `npm-publish` approval until qualification has passed (#769).
- **I10. Provenance.** The registry holds a Sigstore/SLSA attestation binding
  the tarball to this repository, `publish.yml`, the source commit and the
  run, verified anonymously after upload (`publish.yml:737-754`).
- **I11. Fail closed.** A missing, invalid or indeterminate input stops the
  upload. It never degrades to a pass.

One rule is deliberately amended (R5). `docs/PUBLISHING.md:78-80` makes a
dependent's final proof an isolated install after its siblings are verified
in public npm. Under the target, the dependent is proven **before** upload
against its siblings' exact candidate tarballs. The public-npm install
becomes a post-upload check in `verify`.

## 3. Target design

### 3.1 Qualify in the run, not in the job

#1425 says "inside the publish job". Taken literally, that places third-party
code in the job that holds `id-token: write` and the materialized denylist.
Qualification installs the candidate's dependency closure from the public
registry, then imports and runs it. A process on the same runner as the job
can reach that job's OIDC request credentials, whatever environment it was
given. So the job boundary is the control. Candidate code never shares a job
with a write token, OIDC or the denylist (D2, adopted).

### 3.2 Release flow

1. **Release PR.** `release-pr.yml` bumps only packages that will ship (R8).
   CI runs as today. On release PRs, a credential-free cohort qualification
   (the same runner as step 3, given no `PUBLIC_SAFETY_DENYLIST_B64`) joins
   the `build and test` fan-in (`ci.yml:1724`), so it is required without a
   ruleset change. It is report-only for one release first. Its merge-group
   commit is the release commit.
2. **Anchor.** On push to `main`, a small job that runs no package code finds
   the release PR's merge commit in the pushed range, creates the protected
   tag `release/<date>` there, and dispatches `publish.yml` on the tag (R7).
   The tag, not `github.sha`, names the release, so a batched queue merge
   cannot shift it and npm provenance names the right commit.
3. **Release run** (`publish.yml` on the tag):

   ```text
   plan ── pack ──┬── qualify (matrix, per package; legs A and B) ──┐
                  └── reproduce ────────────────────────────────────┴── publish [env: npm-publish, id-token] ── verify
                                                                                    └─> evidence (workflow_run)
   ```

   - `plan` (read): the cohort is every bumped package, in topological order.
     It fails early on an unsatisfiable edge or a name with no published
     identity.
   - `pack` (read, pinned runtime): `npm ci --ignore-scripts`, build, lifecycle
     rehearsal (`publish.yml:306`), `npm pack --ignore-scripts`. Digests
     become **job outputs**. It never installs or imports a candidate's
     closure, so nothing later in the run can rewrite them. It restores no
     Actions cache.
   - `qualify` (read, no token, no environment): each leg downloads the
     tarballs, refuses unless they match the `pack` outputs, and installs the
     candidate together with its cohort siblings' tarballs. It asserts that
     every first-party dependency resolved to the cohort integrity (R5).
     First-party dependencies outside the cohort resolve from the registry as
     today. It saves no Actions cache.
   - `reproduce` (read, fresh runner): deletes every `dist/`, rebuilds from
     the tag commit, packs, and emits digests (**I6**). It restores no
     Actions cache.
   - `publish` (`environment: npm-publish`, `id-token: write`, `contents:
     read`): installs nothing and runs no candidate code. It requires `pack`,
     `reproduce` and the artifact to agree (**I1**, **I6**), validates the
     transcripts and their agreement (**I4**, **I7**), computes the joins at
     the tag commit (**I5**), and runs the FULL gates (unchanged,
     `publish.yml:555-611`). It takes **one approval** for the set (R6), then
     uploads in dependency order. A rerun skips versions already live with
     identical bytes, and fails the run if a version already live has
     different bytes. It restores no Actions cache.
   - `verify` (read): anonymous parity and provenance checks as today, plus
     the post-upload public-npm install of each dependent (R5).

   No job in this pipeline restores or saves an Actions cache: a cache
   written by a job that ran candidate code is itself a write channel, so
   the boundary in 3.1 would otherwise leak through it.
4. **Evidence.** A job that runs no candidate code writes one self-contained
   record per version under `governance/release-publications/later/` (R2).
   The records go into one pull request per release, opened by the repository
   App (R4), and merge on a required mechanical re-derivation check (R3). A
   sweep, running from phase 1, alarms on any registry version without a
   record.
5. **First identities.** npm cannot bind a trusted publisher to a name that
   does not exist yet, so a brand-new package still goes through the
   owner-present path (`docs/PUBLISHING.md:804`). The owner uploads the
   release run's own tarball, checked by digest, off the critical path. There
   is no laptop rebuild.

The approver sees every qualification, reproduction and join result in the
same run before approving (**I9**).

### 3.3 Provenance is already on

`publish-qualified-directory.mjs:391` already runs
`npm publish . --provenance --access public --ignore-scripts` in OIDC mode, and
`publish.yml:737-754` already verifies the attestation anonymously. Every OIDC
upload uses the trusted-publisher binding recorded in #647: repository
`clossys/foundry`, workflow `publish.yml`, environment `npm-publish`. **The
binding does not change.** What changes is that provenance names the run that
qualified the bytes, at the tag commit. The existing
`verifyPublicationProvenance` (`scripts/lib/publication-evidence-run.mjs`)
already cross-checks run and attempt against the attestation.

### 3.4 Evidence carrier

| Carrier | Durable | Readable offline from a clone | Tamper-evident | New permission |
| --- | --- | --- | --- | --- |
| Actions artifact (exists today) | No: retention-limited | No | Digest only | None |
| GitHub release asset per `pkg@version` | Yes | No | No: assets can be replaced | `contents: write` in the publish workflow |
| GitHub artifact attestation | Yes | No: needs the attestation API or Sigstore | Yes | `id-token: write` and `attestations: write` in another job |
| **Committed record written after upload (decided)** | Yes | **Yes** | Git history plus a join to npm provenance | None in `publish.yml`. `record-publication-evidence.yml` already holds job-level `contents: write` and `pull-requests: write` (`:192-193`) under `governance/decisions/publication-evidence-workflow-permissions.json` |

Only a committed record meets **I8**. The lifecycle contract derives state
from evidence in the tree (`docs/LIFECYCLE.md`), and
`check-later-publications.mjs` (`ci.yml:1820`) and the release-readiness
lookup read git. The record:

- is written **after** a successful upload and gates nothing about
  publishing. By then the version is immutably public, so writing the record
  is the remedy for a missing one;
- is self-contained. A new record kind (working name
  `foundry-run-qualified-publication-v1`) embeds today's later-publication
  fields (registry proof, provenance, run, job and artifact bindings) and adds
  both canonical transcripts and the joins, which today live only in the
  pre-publication record;
- is re-derived mechanically by the check that gates its pull request (R3).

Attestation is not added until third-party verification is actually wanted.

### 3.5 Existing records

The retained records stay valid historical evidence under their own
schema. After cutover, a rule refuses any new file under
`governance/release-qualifications/`. CI checks the frozen set by one sealed
digest instead of re-walking it, and the full history walk moves to a weekly
sweep. This fits the sealed-predecessor model already there
(`candidate-qualification.mjs:406-449`).

### 3.6 Deferred versions (R9)

The rule: every deferral still current publishes in the initial cohort run,
and every deferral superseded is formally abandoned — never published, its
file deleted at phase 5. The cohort run re-derives which deferrals are
current from the manifest at run time; the rule does not depend on how many
that turns out to be. #948 is closed as superseded once no publish needs a
developer-machine qualification. Observed on 2026-09-24 (1.2): 14 of 86
deferrals were still current and 72 were superseded.

### 3.7 The merge freeze (R11)

The weekend merge freeze protects publish from a moving `main`. Once publish
reads the release tag, a later merge cannot change what ships, and the freeze
ends as a correctness rule. The Saturday cadence
(`docs/RELEASING.md:58-75`, enforced by `release-calendar.yml`, which is not a
required check) stays only if it is wanted for itself.

## 4. What changes

| Item | Change | Phase |
| --- | --- | --- |
| `.github/workflows/publish.yml` | `pack`, per-package `qualify` legs, `reproduce` and in-run validation (1); a package set, one approval, ordered resumable upload, post-upload dependent install (2); `plan` and runs on `release/*` tags (3). The `npm-publish` environment, `id-token: write` scope, `dry_run` and `verify_only` inputs are kept. | 1-3 |
| `scripts/lib/candidate-runner.mjs` | Gains a cohort-install mode that installs siblings' tarballs and asserts cohort integrity. The literal child environment is unchanged. | 2 |
| `scripts/lib/candidate-runner.mjs` (`assertCredentialFree()`) | Adds `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and `ACTIONS_ID_TOKEN_REQUEST_URL` to the refused-variable list, as defence in depth. The job boundary (D2, 3.1) stays the actual control. | 0 |
| `scripts/validate-candidate-publish.mjs`, `scripts/publish-qualified-directory.mjs` | Accept in-run evidence (joins at the run's commit, two transcripts, digests from job outputs) in place of a committed record (`exactRecord`, `:318-328`). Everything else is unchanged. | 1 |
| `record-publication-evidence.yml`, `scripts/lib/publication-evidence-run.mjs` | Write the self-contained record kind; one PR per release, opened by the App; a fresh branch from the default branch (#1468). | 0-1, 4 |
| New anchor job | Finds the release merge commit, creates `release/<date>`, dispatches `publish.yml`. Runs no package code. | 3 |
| `ci.yml` `build and test` fan-in | Gains the release-PR cohort qualification (report-only for one release) and the evidence re-derivation check. | 3, 4 |
| `.github/workflows/release-pr.yml`, `scripts/apply-release-changesets.mjs` | Bump only shipping packages; write no deferrals; open the PR with the App token. | 4 |
| `.github/workflows/qualify-candidate.yml` | Job split now (#1480). Deleting it at phase 5 and diagnosing with `publish.yml` `dry_run: true` is the recommendation; D6 is open until the owner confirms (8.1). | 0, 5 |
| `auto-qualify.yml`, `select-unqualified-packages.mjs`, `filter-qualification-dispatch.mjs` | Stop re-dispatching a known-failing candidate (#1476); stopped at phase 1; **deleted** at phase 5. | 0, 1, 5 |
| `generate-qualification-record.mjs`, `check-qualification-record-present.mjs` and the `publish.yml:136-149` preflight | **Deleted.** Reproducibility moves to `reproduce`. | 5 |
| `check-qualification-record-required.mjs` and its required context | Report-only under the same name from phase 1; context removed from the ruleset by the owner at phase 5 (R10), then deleted. | 1, 5 |
| Every deferral file (86 observed 2026-09-24), `remove-qualification-deferral.mjs`, `check-qualification-deferral-issues.mjs`, `qualification-deferral-sweep.yml` | **Deleted.** | 5 |
| `governance/release-qualifications/` and `check-candidate-qualification.mjs` | **Frozen** (3.5). The history walk leaves `publish.yml` in phase 0 (#1479). | 0, 5 |
| `docs/PUBLISHING.md` (`:78-80`, section 6 from `:346`), `docs/RELEASING.md:551-556`, `docs/LIFECYCLE.md:167-190`, `AGENTS.md` #833 paragraph | Rewritten in the same pull request as each behaviour change. `LIFECYCLE.md:167-190` needs a new staged site for `@clossys/starter`, whose site is a retained record today. | 2-5 |

The 17 deleted workflow and script files (tests included) total 3,564 lines at `33891d02`. <!-- facts-gate:ignore -->
Without tests they total 2,242 lines: `git show 33891d02:<file> | wc -l` per file. <!-- facts-gate:ignore -->

**#833.** Release qualification runs only on GitHub-hosted runners, which
reach `registry.npmjs.org` without interception. `sanitizedEnv()` stays a
literal with no CA-trust variable, and the `AGENTS.md` position on it is kept.
No release depends on a cloud sandbox.

## 5. Risks and mitigations

### R1. Credential exposure

- *Risk.* A compromised transitive dependency, run during qualification, gains
  a publish capability, forges a passing transcript, or swaps a tarball.
- *Mitigation.* Qualification never shares a job with `id-token: write`, the
  environment or the denylist (3.1). Tarball digests come from `pack`
  outputs, set in a job that never installs a candidate's closure, and must
  agree with an independent `reproduce`. `permissions` stays `contents: read`
  everywhere except `publish` and the evidence job.
- *What leg B does not do.* An earlier draft counted the second qualification
  leg as a tamper control. It is not: both legs run the same candidate, so a
  malicious candidate can forge both transcripts alike. Leg B catches
  nondeterminism (**I7**). It is kept until 3 releases show zero leg
  disagreement, then dropped with that measurement recorded.
- *Residual.* A build-toolchain compromise that behaves the same in `pack`,
  `reproduce` and every leg is out of scope for every design. The lockfile
  and npm provenance are the controls for that class.

### R2. Reproducibility

- *Mitigation.* The anchor is agreement between `pack` and `reproduce` on the
  pinned runtime, which is stronger than today's single rebuild. npm's
  integrity field and the provenance statement then pin the bytes
  permanently. The record carries both.

### R3. Failure part way through a release

- *Risk.* Some versions upload, then the run fails.
- *Mitigation.* One `npm publish` is atomic. Upload order is topological, so
  a dependent never goes live before its dependencies. A rerun skips versions
  already live with identical bytes and continues. Verification that runs out
  of time stays indeterminate, never failure (#790). A bad version is fixed
  forward, as today.

### R4. Offline audit

- *Mitigation.* The self-contained record (3.4), and a sweep extending
  `check-later-publications.mjs`, running from phase 1, that fails when a
  registry version has no record. Sigstore signature checks still need the
  network, as today.

### R5. Tag trust

- *Risk.* A `release/*` tag is moved or created by someone else, and the run
  publishes the wrong commit.
- *Mitigation.* A tag ruleset (owner-only) protects `release/*`. The
  `npm-publish` environment admits `release/*` tags; `refs/heads/main` is
  removed from it only after the phase 3 gate passes (owner-only). The
  approval still applies. `plan` refuses a tag that is not a first-parent
  merge commit on `main`.

### R6. Concurrency

- *Risk.* The Free plan's 20-concurrent-job cap (`ci.yml:69`) queues the
  qualify matrix behind other work.
- *Mitigation.* This costs time, not correctness. The legs are seconds of
  work each (1.3), and dropping leg B later removes a job per package.

### R7. Rollback of the migration

- *Mitigation.* Every phase is one or more revertible pull requests and leaves
  `main` publishable. The record path stays callable until phase 5, so
  reverting a phase restores the earlier behaviour without rewriting history.

### R8. Loss of pre-merge signal

- *Mitigation.* The release-PR cohort qualification (3.2 step 1) blocks a
  failing candidate before merge. `publish.yml` with `dry_run: true` runs the
  whole graph except the upload, at any time.

## 6. Alternatives considered

**A. Keep qualify PRs, one per release.** Cuts PR count from N to 1, but
keeps tree-hash invalidation, deferrals, double qualification and serial
rounds for dependents.

**B. Qualify on the release PR branch as the binding evidence.** The record
binds the PR head, not the queue's merge commit, and any merge queued ahead
invalidates it (#1218, moved earlier). `docs/PUBLISHING.md:389-391` defers
PR-side qualification so untrusted PR code never receives publish
credentials.

**C. #1435's first draft as the end state.** Qualify in the publish run and
write the record after upload. Sound, and kept as phase 1. Alone it keeps the
freeze, the serial rounds and one dispatch and one approval per package.

**D. Commit the evidence into the release commit before merge.** Rejected for
four reasons. It runs candidate code in the workflow that pushes the release
branch. Any fix on the release PR forces a full regeneration. It creates two
records per version. It proves PR-branch bytes and needs a queue re-pack to
carry them to the merge commit, while the release run proves the bytes it
uploads.

**Decided: the release run at the release commit, with C as phase 1** (R1).

## 7. Migration plan

Each phase is one or more pull requests, is useful alone, and leaves `main`
publishable. "Gate" is the evidence that proves the phase works, recorded in
#1425 as the command and its output, not a summary.

| Phase | Adds | Deletes | Gate | Revert | Issues |
| --- | --- | --- | --- | --- | --- |
| **0. No-regret, in flight** | The qualify-candidate job split (#1480). Release-workflow fixes (#1481). A fresh evidence branch per batch (#1468). `assertCredentialFree()` refuses `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and `ACTIONS_ID_TOKEN_REQUEST_URL` as defence in depth (D4). | The history re-walk from `publish.yml`'s `qualify` job (#1479). `auto-qualify.yml`'s blind re-dispatch of a candidate whose last run for that exact version failed (#1476). | Each PR's own tests. The next publish run's `qualify` job no longer contains `check:candidate-qualification`. | One PR each. | Closes #1480, #1481 (with #1439, #1392, #1462), #1468, #1479, #1476. |
| **1. In-run evidence** (#1435's design) | `pack`, two `qualify` legs, `reproduce`, in-run validation behind `evidence: record \| in-run` (default `record`). The self-contained record kind. Then default `in-run`; `qualification record required` report-only under the same name; `publish-qualified-set.mjs` on in-run evidence. The registry sweep (extending `check-later-publications.mjs`) that fails when a registry version has no record. | `auto-qualify.yml` stops dispatching. | `dry_run: true` for every package and `verify_only: true` for published ones; one leaf package published with `evidence: in-run`, `verify-published` green; its record re-derived from a clone offline; sweep green. | Set the default back to `record`. | Closes #948. Makes #1477 moot for qualify PRs. |
| **2. Cohort** | Cohort-install mode and the integrity assertion. `publish.yml` takes a package set: one `publish` job, one approval, topological resumable upload, post-upload public-npm install of dependents. `PUBLISHING.md:78-80` amended. | Per-package dispatch and approval. | A `dry_run` of a set with a runtime edge; then the initial cohort run publishes every deferral still current, re-derived from the manifest at run time (14 of 86, observed 2026-09-24; R9), every dependent's install green in `verify`. | Dispatch single packages. | Makes #1476 moot (no `ETARGET` rounds). |
| **3. Anchor** | The anchor job, `plan`, runs on `release/*` tags. The release-PR cohort qualification in the `build and test` fan-in, report-only for one release. | Manual publish dispatch. The freeze as a correctness rule, once the phase 3 gate passes (R11). | One release published from its tag; provenance names the tag commit; a merge landing between tag and approval does not change the uploaded bytes. | Remove the trigger; dispatch from `main` as in phase 2, restoring `refs/heads/main` in the `npm-publish` environment's admission. | Makes #1331, #1389 and #1391 moot once the freeze ends. |
| **4. Generator** | `release-pr.yml` bumps only shipping packages and writes no deferrals. The App opens release and evidence PRs. The evidence re-derivation check becomes required through the fan-in. | Hand-written deferrals. | A release PR opened by the App gets full CI on its first run; the evidence PR merges on the check alone. #1377 and #1390 land first. | Revert the PR; the workflow token opens PRs as today. | Closes #1477. Reshapes #941: a citation fix needs only a changeset, not its own record or deferral. |
| **5. Delete and freeze** | Sealed digest for the records retained at cutover (192 observed 2026-09-24), weekly full walk. Docs rewritten (section 4). | After one report-only release and the owner's ruleset change (R10): everything marked deleted in section 4, including `qualify-candidate.yml` (D6, open — see 8.1) and every deferral file (86 observed 2026-09-24). | CI green without the deleted files; the sweep finds a record for every registry version; CI no longer re-walks history per run. | Restore the files from history; the owner re-adds the context. | |
| **6. Optional** | Artifact attestation, only if third-party verification is wanted. | Leg B, after 3 releases with zero disagreement. | The recorded leg-agreement measurement. | Remove the job; restore the leg. | |

Estimated steady state, from today's measured job timings, not measured: about
95 min from opening the release PR to live, about 30 min after merge with a
prompt approval; 3 owner acts per release (enqueue the release PR, one
approval, and a dispatch if generation is not scheduled), plus 2 when a
release has a brand-new package; about 110 executed jobs if evidence folds
into the next release PR, about 170 with one evidence PR per release (the
decided option, R3).

## 8. Decisions (recorded 2026-09-24)

The owner accepted every recommendation on 2026-09-24, except D6, which
offered no recommendation and stays open.

### 8.1 The draft's D1 to D8

| Draft decision | Outcome | Recorded as |
| --- | --- | --- |
| D1. Adopt proposal C | Adopted as **phase 1** of a larger target: one release run at the merged release commit. A and B rejected; a fourth option (D in section 6) also rejected. | R1 |
| D2. "Publish run, separate credential-free job" | Adopted. Qualify in the run, not the job. | technical recommendation |
| D3. Remove `qualification record required` from the ruleset | Adopted: at cutover (phase 5), after one release in which it was report-only. | R10 |
| D4. Extend `assertCredentialFree()` | Adopted as defence in depth only: add `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and `ACTIONS_ID_TOKEN_REQUEST_URL` to the refused list. It makes the check stricter and nothing else; the job boundary (D2) stays the control. Its own pull request, phase 0. | technical recommendation |
| D5. Evidence carriers | The committed post-publish record only. No attestation until third-party verification is wanted. Release assets rejected. | R2; technical recommendation |
| D6. Diagnostic qualification dispatch | Open: the draft offered two options (delete `qualify-candidate.yml` and diagnose with `publish.yml` `dry_run`; or keep it) and recommended neither. The technical recommendation is delete; the owner confirms at phase 5. | open, confirm at phase 5 |
| D7. Deferred versions | Rule: every deferral superseded is formally abandoned; every deferral still current publishes in the initial cohort run. The cohort run re-derives the current list from the manifest at run time — the decision does not depend on a count. (Observed 2026-09-24: 72 of 86 superseded, 14 current — 1.2. The draft's earlier commit observed 72 files, 53 superseded and 19 current, on its own measurement date.) | R9 |
| D8. Record location | `governance/release-publications/later/`, one self-contained file per version. | R2 |

### 8.2 The owner's decisions

| # | Decision | Phase |
| --- | --- | --- |
| R1 | The target is one release run at the merged release commit. #1435's design is phase 1. | 1 |
| R2 | The durable proof is a git record written after upload: one self-contained file per version under `governance/release-publications/later/`. | 1 |
| R3 | The per-release evidence PR merges on a required mechanical re-derivation check. | 4 |
| R4 | A GitHub App scoped to this repository (contents and pull-requests write), used only in jobs that run no package code, opens release and evidence PRs. | 4 |
| R5 | Dependents are proven before upload against their siblings' exact candidate tarballs. The public-npm install moves to a post-upload check (amends `docs/PUBLISHING.md:78-80`). | 2 |
| R6 | One `npm-publish` approval per release set. | 2 |
| R7 | Tag the merged release commit `release/<date>` and publish from the tag automatically, stopping at the approval. This reverses #757's "a merged bump is not a release" (`publish.yml:3-6`). | 3 |
| R8 | A release publishes every version it bumps. Unready packages keep their changesets pending. | 4 |
| R9 | Rule: every deferral still current publishes in the initial cohort run; every deferral superseded is formally abandoned. The cohort run re-derives the current list from the manifest at run time, not from a recorded count. (Observed 2026-09-24: 14 current, 72 superseded, of 86 — 1.2.) | 2, 5 |
| R10 | Remove `qualification record required` from the `main` ruleset at cutover, after one report-only release. | 5 |
| R11 | End the weekend merge freeze as a correctness rule once publish reads the release tag. Keep the calendar cadence only if it is wanted for itself. | 3 |

Technical recommendations adopted with them: qualify in the run, not the job
(D2); extend `assertCredentialFree()` as defence in depth (D4, phase 0); keep
the second qualification leg until 3 clean releases; freeze the existing
records with a sealed digest and a weekly walk; no attestation until
third-party verification is wanted; do phase 0 now. D6 (delete
`qualify-candidate.yml`, diagnose with `publish.yml` `dry_run`) is not among
these: it is open, and the owner confirms it at phase 5 (8.1).

### 8.3 Owner-only actions

Only the owner can do these. No phase that needs one lands before it is done.

| Phase | Owner-only action |
| --- | --- |
| 0 | None. |
| 1 | None new. Publish approvals as today. |
| 2 | None new. One approval per release set replaces one per package. |
| 3 | Allow `release/*` tags in the `npm-publish` environment's deployment rule. Create a tag ruleset protecting `release/*`, with creation limited to the identity the anchor job uses (`GITHUB_TOKEN` until phase 4, then the App; see below). After the phase 3 gate passes, remove `refs/heads/main` from the `npm-publish` environment's deployment rule. |
| 4 | Create the GitHub App: this repository only, contents and pull-requests write. Install it and store its credentials as repository secrets. |
| 5 | Remove `qualification record required (version bump vs. retained record)` from the `main` ruleset, after one report-only release. Say whether the Saturday cadence stays. Confirm D6: delete `qualify-candidate.yml`, or keep it. |
| 6 | Decide whether third-party verification is wanted before any attestation job is added. |

**Phase 3 anchor identity.** Until the GitHub App arrives in phase 4, the
anchor job creates the `release/<date>` tag using the workflow's own
`GITHUB_TOKEN`, scoped to that job's `contents: write` permission. Risk: any
job in this repository holding `contents: write` could, in principle, create
a tag matching `release/*`. The limits on that risk are the two checks
already in this design: `plan` refuses a tag that is not a first-parent
merge commit on `main` (5, R5), and the run still stops for the
`npm-publish` approval before anything uploads.

**First identities stay owner-only.** The owner-present upload for a
brand-new package's first identity (3.2 step 5) is unchanged by any phase:
it remains owner-only, as today.
