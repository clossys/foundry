# RFC: apply an approved plan as one pull request per repository

- **Status:** draft, awaiting owner decisions. Documentation only: this file
  changes no code, contract, workflow or gate.
- **Tracking issue:** #1178 (the M2 delivery layer). Interacts with #1334
  (inventory validation), #1173 (shared engagement context), #1215 (product
  repository standard), #1175 (plan file contract), #1179 (clone on approval)
  and the client-journey tracker #1187.
- **Read against:** `origin/main` at `53d5ef68`. Every `file:line` below was
  read at that commit.

## Summary

An approved plan should turn into exactly one reviewable pull request in
each affected client repository, carrying exactly the bytes the plan
approved, and proved by that repository's own CI. Today Launcher stops after
writing one file into one working tree.

This RFC proposes a **sealed change set** per repository, split across two
owners at the credential boundary:

1. **Packages** compute the change set from the approved plan: a
   content-addressed manifest of every file the pull request will add or
   change, the pull request text, and the preconditions. They write those
   bytes into a clean local clone and verify the result. None of this needs a
   credential, and all of it can be tested offline against a fixture hub.
2. **The client's own coding agent** does the live part under the client's
   own credentials: create the branch, commit, push, and open the pull
   request with the text the package rendered.
3. **Packages verify on both sides of the agent's step.** `verify` runs
   before the push and `status` runs after the pull request is opened. Both
   compare the pushed tree against the change-set digest. The client
   repository's CI then proves the install (Starter) and checks that the
   pull request touches only the declared paths.

This keeps the grooming principle ("packages own the deterministic
mechanics; the client's agent makes the live changes"). It amends it in one
way: an agent step with no verification on both sides would let phrasing
change the bytes, and #1178 exists to rule that out.

## 1. Problem and current state

### 1.1 What produces an "approved plan" today

There are two different artifacts that could be called "the approved plan",
and nothing joins them.

| Artifact | Where it is defined | What "approved" means | What it binds |
| --- | --- | --- | --- |
| `clossys/advisor/plan.json`, the status plan (#1175) | Advisor `packages/advisor/src/status.ts:103-112` (`AdvisorPlan`); Launcher's own copy `packages/launcher/src/apply-plan.ts:59-67` | The most recent `decisions[]` entry has `chosen === "approved"` (`apply-plan.ts:139-143`) | Nothing. A decision is `{ at, recommended, chosen, by }` (`status.ts:74-79`). It carries no digest, so it cannot say *which* plan bytes were approved. |
| Advisor assessment with `firstWave.workItems` and `engagement.executionAuthorization` | `packages/advisor/src/types.ts:65-72` (`ImmutablePackageRef`, `RollbackDefinition`, `FirstWaveAct = "install" \| "remove" \| "relocate"`, `FirstWaveWorkItem` with `targetRepositoryId`, `package{name,version,integrity}`, `placement`, `rollback`, `mutationSurfaces`); `types.ts:92` (`ExecutionAuthorization`) | `advisor-execution-readiness <assessment.json> <now>` exits `0` (`packages/advisor/src/execution-readiness-cli.ts:6-14`), after re-deriving readiness at a runner-supplied instant (`execution-readiness.ts:29-50`) | `planDigest` (`sha256:` shape, `authorization.ts:23`), the assessment basis, `permittedRepositoryIds`, `permittedPackages` and `permittedMutationSurfaces`, each required to equal the approved work items exactly (`authorization.ts:54-61`), plus `grantedAt`/`expiresAt` |

The second artifact is what #1178's step 1 means ("re-run
`advisor-execution-readiness` against the retained plan and grant"). It is
the one that binds exact packages and repositories. It is also the one
Launcher does not read.

### 1.2 What Launcher does today, and where it stops

| Step | Evidence | State |
| --- | --- | --- |
| Validate `plan.json` shape | `apply-plan.ts:104-131` | Exists, but drifted from Advisor: Launcher requires `blockers[].description` (`apply-plan.ts:126`), while Advisor's contract requires `capabilityId`, `nextAction{who,how,byWhen}` and `since` and has no `description` (`status.ts:94-101`, `:173-183`). A plan with a blocker that is valid to Advisor fails Launcher. |
| Decide "approved" | `apply-plan.ts:139-143` | Exists. It binds no digest (see 1.1). |
| Validate the brief | `apply-plan.ts:82-100` | Exists, but ignores `context` and extra top-level keys. The fixed-choice-id rule for `context` is enforced only when Advisor builds the brief (`packages/advisor/src/engagement-brief.ts:97-119`), not where Launcher writes it. This was raised on #1178 from the #1378 review. Launcher's `EngagementBrief` type (`apply-plan.ts:35-41`) also has no `context` field. |
| Write `clossys/brief.json` into one directory | `apply-plan.ts:154-172`; CLI `apply-plan-cli.ts:6-18` (`--plan --brief --repo`) | Exists. It writes into a working tree: no branch, no commit, no pull request. |
| Map roles to repositories (`staffing`, `staffedHere`) | #1178 comment of 2026-09-23 | Not built: `grep -rn "staffing\|staffedHere" packages/*/src` finds nothing. |
| Read install, remove and relocate work items | `types.ts:69-71` | Not built. `apply-plan.ts:9-15` defers "branch creation, exact package installs, Starter's caller workflow, opening one pull request per repository". |
| Add Starter's caller workflow | `packages/starter/documents/caller-workflow.md` | Not built. There is only a template to copy by hand. |
| Open pull requests | none | Not built. The Launcher README still says "Appoint does not install packages" (`packages/launcher/README.md:150-151`). |

### 1.3 Adjacent behaviour an apply step would inherit

- **Inventory acceptance is shape-only (#1334).** `inspectInventory()`
  counts any document with `schemaVersion: 1` and a non-empty `repositories`
  array as `populated` (`packages/launcher/src/core.ts:237-249`). Appoint's
  `--inventory` accepts on that basis alone (`core.ts:434-439`). An entry's
  only meaningful field is `id` (`core.ts:396-408`). #1334 reproduced a
  governance record being accepted and 21 skill files written with exit `0`.
  Any apply step that trusts the inventory inherits this defect.
- **Sibling checkouts are written without a clean-tree check.** Appoint
  refuses a dirty hub (`core.ts:653-669`), but skills are composed into
  sibling checkouts after checking only that the origin matches the
  inventory id (`core.ts:1001-1008`, `:1152-1157`). A sibling's uncommitted
  work and Launcher's output end up in the same working tree.
- **Launcher already makes live GitHub changes.** On an empty directory it
  runs `gh repo create … --private --push` (`core.ts:1243-1248`). With
  `--clone-missing` it runs `gh repo clone` (`core.ts:1048`). Both use the
  client's authenticated `gh`. So "packages never make live changes" is not
  true of Launcher today. Section 5 deals with this.
- **Advisor treats digests as opaque.** It compares them as strings and
  "does not interpret or re-derive them" (`packages/advisor/README.md:56`).
  Nothing in the repository defines how `planDigest` is computed, so no
  apply step can check that the plan it holds is the plan that was
  authorized.
- **Starter proves from the protected base.** Its trusted job checks out the
  pull request's *base* (`caller-workflow.md:12-17`, `:141`), and the
  request naming the exact target packages lives in that base
  (`caller-workflow.md:23-29`; `packages/starter/README.md:32-35`). A pull
  request that adds the caller workflow and request cannot be proved by
  them. See section 9.
- **The brief can reach a public repository.** Advisor documents that the
  brief "is committed in every staffed repository, which may be public"
  (`engagement-brief.ts:70-72`). `problem` is "the client's problem, in
  their own words" (`engagement-brief.ts:25`). The context snapshot is
  guarded against founder prose; `problem` is not.

### 1.4 The gap in one sentence

The authority that binds exact packages and repositories (the execution
authorization) is never read by the one tool that writes. The tool that
writes binds nothing it can check, and nothing between them produces a
pull request.

## 2. Goals and non-goals

### Goals

- **G1.** An approved plan yields at most one open pull request per affected
  repository, against that repository's default branch. A repository whose
  initial setup is still pending gets one setup pull request before it; see
  D3.
- **G2.** The pull request's tree is fully determined by the approved plan,
  the approved inventory and the repository's base commit. Re-running with
  the same inputs yields the same change-set digest.
- **G3.** No live change happens until every validation in section 7 has
  passed for that repository.
- **G4.** Any interruption can be resumed, and the resumed run reaches the
  same end state. A missing clone or failed precondition is reported as
  `indeterminate` for that repository, never as partial success (#1178 step
  5).
- **G5.** Every applied change has a derived inverse change set, so a revert
  is also a reviewable pull request.
- **G6.** Package code holds no credential and needs no network write, so
  the whole deterministic half runs in tests against a fixture hub.
- **G7.** Nothing private reaches a public surface. This covers committed
  files and also pull request titles and bodies, which on a public
  repository are permanent and emailed to watchers. This repository's own
  `AGENTS.md` ("Conversation surface") records that lesson.

### Non-goals

- Deciding what to install. That is Advisor's job, and Advisor stays pure
  (`packages/advisor/README.md:5`).
- Merging. The client merges. #1187 states that "approval is a merged pull
  request in the client's own repository".
- Cross-repository atomicity. GitHub offers none; section 6 designs for
  independent pull requests instead.
- Deploying, provider CLIs, or application code (`apps/*`). These stay with
  the agent and Builder (#1211).
- Detecting drift after merge. That is Integrator's job (#885).
- Hosting a service or holding a GitHub App credential. See alternative B.

## 3. Threat model

Assets: the client's GitHub credentials, each client repository's default
branch, the client's business context, and the exactness of what gets
installed.

| # | Threat | Where it would enter | Mitigation in this design |
| --- | --- | --- | --- |
| T1 | **Credential exposure.** A package handles or logs a token, or a third-party install script runs while a token is in the environment. | Any package step that calls `gh`, `git push` or `npm install`. | Package steps take no token and make no authenticated call. Materialization regenerates the lockfile with `npm install --package-lock-only --ignore-scripts` (Starter already uses `--ignore-scripts`, `caller-workflow.md:113-114`) under a sanitized environment that forwards no `*_TOKEN`. Push and pull request creation happen in the agent, under the client's session. |
| T2 | **Blast radius across repositories.** One bad plan edits every inventoried repository, or a repository outside the approved set. | Staffing and inventory resolution. | A change set is computed only for a repository that is (a) in `executionAuthorization.permittedRepositoryIds` or, for a staffing-only set, in the approved `staffing` list, (b) present in an inventory that passes the strict validation in section 7 (#1334), and (c) a clone whose origin matches its id (existing check, `core.ts:1001-1006`). Each change set also carries its own path allow-list, and a CI check refuses any pull request touching a path outside it. |
| T3 | **Partial application.** Some repositories get their pull request and others fail, and the run reports success. | The per-repository loop. | Results are per repository and use the ternary. The bundle is `satisfied` only when every in-scope repository is `proposed` or `applied`. Otherwise it is `indeterminate` (something could not be observed) or `violated` (a precondition failed), with a per-repository reason. Pull requests are designed to stand alone (section 6), so a partial state is safe to leave, and resuming completes it. |
| T4 | **Replay.** A stale or superseded approval is used again, or an old change set is re-pushed after the plan has changed. | Resume, or copying a bundle to another hub. | The change-set digest covers the plan digest, the authorization's `expiresAt`, the base commit and the file set. `verify` re-runs execution readiness at the current instant, so an expired or superseded grant refuses. Branch names and pull request markers carry the digest, so a stale set is recognized as `superseded`, never merged over a newer one. |
| T5 | **Tampering between verify and push.** The agent, or anything in its session, edits files after `verify` or adds an unrelated commit. | The agent step. | `status` compares the pushed head tree with the digest after the fact. The CI path-scope check refuses undeclared paths. The digest is shown in the pull request body, so the client can see which bytes they are approving. Section 5 argues that this is enough; alternative A is the stronger option if it is not. |
| T6 | **Privacy leak into a public repository.** Founder prose appears in `clossys/brief.json` or a pull request body in a public repository. | Brief writing, pull request rendering. | Target visibility is observed (`gh repo view --json visibility`, read-only) before materializing. The brief is validated at the write boundary with Advisor's own context rule. For a public target, free-text `problem` is refused unless the owner decides otherwise (D4). Pull request text is rendered from fixed ids and digests only, never from context or `problem`. |
| T7 | **Supply-chain substitution.** The installed tarball differs from the one approved. | Lockfile regeneration. | The change set pins `name@version#integrity` from `ImmutablePackageRef` (`types.ts:65`). `verify` checks that the regenerated lockfile's `integrity` for that package equals the plan's SRI, and that no other top-level dependency changed. Starter then re-proves the install in CI from the protected base. |
| T8 | **Mis-scoped inventory (#1334).** A foreign document is treated as the inventory. | `--inventory`, `externalInventory`. | Strict schema validation (section 7, V1). A `custom`-shaped external inventory stays `indeterminate`, as it already does (`packages/launcher/src/inventory-adoption.ts:59-67`). |

Out of scope: a compromised client machine or agent session. Such a session
already holds the client's credentials. The design only makes sure the
package half never widens what that session can do.

## 4. Data model

Three documents, all JSON with `schemaVersion`, all under the hub's
`clossys/.state/apply/`. They are machine files, like the existing hub
state. Each gets a contract file in `docs/contracts/`.

### 4.1 Inputs (already exist, unchanged by this RFC)

- `clossys/advisor/plan.json` (`AdvisorPlan`, #1175), extended per the #1178
  comment with `staffing: [{ repository, roles }]`. The repository value is an
  inventory id, never a URL or path.
- The Advisor assessment carrying `firstWave.workItems` and
  `executionAuthorization` (section 1.1).
- The `EngagementBrief` from `toEngagementBrief()`
  (`engagement-brief.ts:55-89`), with `staffedHere` per repository.
- `clossys/.state/inventory.json`, strictly validated (section 7).

### 4.2 `ApplyBundle`: one per application attempt

```json
{
  "schemaVersion": 1,
  "kind": "clossys.apply-bundle",
  "plan": { "path": "clossys/advisor/plan.json", "digest": "sha256:<64 hex>" },
  "authorization": { "planDigest": "sha256:<64 hex>", "expiresAt": "2026-10-01T00:00:00Z" },
  "computedAt": "2026-09-24T12:00:00Z",
  "repositories": [
    { "id": "example-owner/product", "state": "planned", "changeSet": "sha256:<64 hex>" },
    { "id": "example-owner/docs", "state": "skipped", "reason": "not-in-inventory" }
  ],
  "bundleDigest": "sha256:<64 hex>"
}
```

`authorization` is `null` for a staffing-only bundle, meaning brief, skills
and layout with no package acts (see D2). `plan.digest` uses one canonical
serialization, defined once in a contract and used by Advisor and Launcher
alike. The candidate is Advisor's `stableStringify`, which is private
today (`capability-catalogue.ts:129-145`) and would move into the shared
contract. The canonical digest closes the gap in 1.3 where `planDigest` is
opaque.

### 4.3 `RepositoryChangeSet`: one per repository

```json
{
  "schemaVersion": 1,
  "kind": "clossys.repository-change-set",
  "bundle": "sha256:<bundleDigest>",
  "repository": {
    "id": "example-owner/product",
    "visibility": "private",
    "defaultBranch": "main",
    "baseCommit": "<40 hex>"
  },
  "phase": "setup | apply",
  "branch": "clossys/apply-<first 12 hex of changeSetDigest>",
  "items": [
    { "id": "brief", "act": "write-record", "source": "engagement-brief" },
    { "id": "skills", "act": "compose-skills", "roles": ["strategist", "writer"] },
    { "id": "wi-1", "act": "install", "planItem": "wi-1",
      "package": { "name": "@clossys/strategist", "version": "0.0.0", "integrity": "sha512-…" },
      "placement": "devDependencies" }
  ],
  "files": [
    { "path": "clossys/brief.json", "mode": "100644", "before": null, "after": "sha256:…", "item": "brief" },
    { "path": "package.json", "mode": "100644", "before": "sha256:…", "after": "sha256:…", "item": "wi-1" },
    { "path": "package-lock.json", "mode": "100644", "before": "sha256:…", "derived": true, "item": "wi-1",
      "invariants": [{ "lockPath": "node_modules/@clossys/strategist", "integrity": "sha512-…" }] }
  ],
  "pathAllowList": ["clossys/**", ".agents/skills/clossys-*/**", "package.json", "package-lock.json"],
  "pullRequest": { "title": "Clossys: apply plan <12 hex>", "bodySha256": "sha256:…" },
  "inverse": "sha256:<digest of the derived revert change set>",
  "changeSetDigest": "sha256:<64 hex>"
}
```

Notes on the shape:

- `before` records the base content hash of each file. It makes the
  inverse change set derivable, and it detects a base that moved under a
  file the set touches.
- `derived: true` marks a file whose bytes depend on tooling, such as a
  lockfile. It is checked by `invariants`, not byte equality, and it is
  excluded from `changeSetDigest`. A lockfile regenerated by a different
  npm minor version would otherwise break idempotency for no safety gain.
  See D7.
- `items[].planItem` links each act to a `FirstWaveWorkItem.id`, so the pull
  request can cite its plan items and metric targets (#1178 step 4) by id
  instead of by prose.
- The digest excludes timestamps, so recomputing from the same inputs gives
  the same set (G2).

### 4.4 Repository states (derived, never declared)

Following `docs/LIFECYCLE.md`, a repository's apply state is recomputed
from evidence each time. Nothing records "done" by assertion.

| State | Evidence that derives it |
| --- | --- |
| `planned` | A change set exists in the bundle, and no matching branch or pull request is observed. |
| `materialized` | A local clean clone on `branch` has a working tree matching every non-derived `after` hash, and its invariants hold. |
| `proposed` | An open pull request whose head tree matches the change set, and whose body carries the `changeSetDigest` marker. |
| `applied` | The default branch contains every `after` hash, from a merged pull request or because it was already there. |
| `superseded` | An open pull request carries an older `changeSetDigest` for the same repository. |
| `diverged` | A pull request with the marker exists, but its head tree does not match. This is T5. |
| `indeterminate` | The clone is missing, `gh` is unavailable, visibility cannot be read, or the base moved under a `before` hash. |

## 5. Division of labour: testing the principle

The grooming principle says packages own the deterministic mechanics and the
client's agent makes the live changes. It is tested below against the code
and the issues.

### 5.1 The case for it

- **#1187's own test says so.** The governing principle (2026-09-22
  comment) says: "If it is creative, or it changes a live external
  system, the agent does it with the human's approval." Pushing a branch and opening a
  pull request change a live external system. On a public repository they
  are permanent and emailed.
- **Credentials stay out of packages.** Starter is credentialless by design
  (`caller-workflow.md:12-17`). Cloud sessions receive no publication
  credentials (`AGENTS.md`, "Cloud sessions"). Keeping the push in the agent
  means the whole deterministic half runs in CI and in the fixture test
  #1178 asks for, with no token at all (G6).
- **Host neutrality.** The self-serve default is a cloud agent session with
  browser plus GitHub (#1187, #1220 decision). In such a session, GitHub
  access is whatever integration the host provides, not necessarily a local
  `gh`. A package that shells out to `gh pr create` would fail on the
  default entry path. "Packages never depend on a particular agent; the
  skills are the interface" (#1187).
- **#1178's real concern is met another way.** "Exact versions and hashes
  should never vary with phrasing" is about the *bytes*. The change set
  fixes the bytes, and `verify` and `status` check them. Who types
  `git push` does not change them.

### 5.2 The case against it

- **#1178 and #1187's ownership table say Launcher applies the plan "as
  pull requests"**, as deterministic tooling rather than an agent. Read
  literally, that puts the pull request in the package.
- **Launcher already crosses the line.** It runs `gh repo create --push`
  (`core.ts:1243-1248`) and `gh repo clone` (`core.ts:1048`) under the
  client's `gh`. Consistency would let it push branches too.
- **An agent can skip steps.** It can commit without running `verify`, add
  an unrelated file, or write its own pull request body containing context
  prose. A package that pushes cannot improvise.
- **More steps for a non-technical client.** In practice the agent performs
  them, but the client sees more of them.

### 5.3 Verdict

**Adopt the principle, with two amendments.**

1. **Draw the line at the credential, and put verification on both sides
   of it.** Packages compute, materialize (file writes into a clean local
   clone, as `applyEngagementBrief` already does, `apply-plan.ts:154-172`),
   verify before push, and observe after. The agent performs the
   credentialed steps with package-rendered text. An agent that skips
   `verify` is caught by `status` (`diverged`) and by the CI path-scope
   check. The client sees the digest in the pull request before merging. The
   remaining risk is an agent that bypasses all three *and* a client who
   merges a pull request whose status says `diverged`. That risk is judged
   acceptable, because the same session could edit the default branch
   directly in any design.
2. **Treat the existing `gh repo create --push` as a documented exception,
   not a precedent.** It creates an empty private hub from a packed
   skeleton, has no client content, and predates #1187. Whether it moves to
   the agent later is D5. It does not justify adding more live writes.

The resulting split:

| Step | Owner | Credential | Command (proposed) |
| --- | --- | --- | --- |
| Decide what to change, staffing, work items, brief | Advisor (pure) | none | existing |
| Authorize | Human (sponsor) | their GitHub identity, via merged plan or grant | existing |
| Validate inputs and compute the bundle and change sets | Launcher | none | `launcher-apply-plan plan` |
| Write bytes into a clean local clone | Launcher | none (local file writes; lockfile via `--ignore-scripts`) | `launcher-apply-plan materialize --repo <id>` |
| Verify the working tree against the digest | Launcher | none | `launcher-apply-plan verify --repo <id>` |
| Branch, commit, push, open the pull request with the rendered body | Client's agent | client's | host's own git and GitHub tools |
| Observe and derive states | Launcher | read-only `gh`, as `checkInventoryEntries()` already does | `launcher-apply-plan status` |
| Prove the install | Starter, in the client's CI | none (credentialless) | caller workflow |
| Check that the pull request touches only declared paths | Client's CI, via a Controller CI template job | none | template job |
| Merge | Human | client's | GitHub |
| Detect later drift | Integrator | none | existing |

The composed Launcher skill carries the agent's side as a fixed procedure:
run `verify`, then commit, push and open the pull request using the rendered
body file, then run `status`, and stop on anything other than `proposed`.
That skill is the interface #1187 names.

## 6. Idempotency, resume and rollback

**Idempotency key.** Each repository's key is its `changeSetDigest`. The
branch name and a pull request body marker
(`<!-- clossys-change-set: sha256:… -->`, a digest only) carry it. Every
command first derives the state (4.4) and then does only what that state
still needs:

| Derived state on re-run | Action |
| --- | --- |
| `applied` | No-op. Report `applied`. This also covers a client who made the same change by hand. |
| `proposed` (same digest) | No-op. Report the pull request. |
| `materialized` | Resume at the agent step. |
| `planned` | Materialize. |
| `superseded` | Compute the new set on a new branch. The rendered body says which pull request it replaces, and the agent closes the old one. No force-push and no rewriting of the old branch, in line with this repository's own branch rules. See D6. |
| `diverged` | Stop that repository. Report which paths differ. Never "fix up" a pushed branch. |
| `indeterminate` | Stop that repository and report why. Other repositories continue (T3). |

**Resume.** Resuming is re-running. Progress is derived, so no ledger can
disagree with the repositories. The bundle file is kept only so a later run
can say "this is the same attempt" and flag `superseded` sets.

**Base movement.** If the default branch moved but no `before` hash
changed, the set is recomputed against the new base. It gets a new
`baseCommit`, and because the digest covers `baseCommit`, a new branch. If
a `before` hash changed, the repository is `indeterminate` with a
`base-conflict` reason, and Advisor re-plans.

**Cross-repository ordering.** A change set must be valid alone. It never
depends on another repository's merge. If a plan needs ordering across
repositories, Advisor expresses it as successive bundles, not as coupled
pull requests. Within one repository, the setup phase precedes the apply
phase (section 9).

**Rollback.**
- Before merge: close the pull request and delete the branch (agent). The
  state returns to `planned`, or drops out when the plan changes.
- After merge: `launcher-apply-plan revert --repo <id>` materializes the
  `inverse` change set. It restores every `before` hash, or deletes a file
  whose `before` was `null`. For package acts it uses the work item's own
  declared `rollback` (`types.ts:67`, `:71`): `install` inverts to an exact
  `remove`, and `relocate` inverts to relocating back. The revert is a normal
  pull request through the same verify, CI and merge path. The default branch
  is never rewritten.

## 7. Validation before any live change

Everything below runs locally, read-only against GitHub, before a change set
may be materialized. A failure for one repository refuses that repository
only and writes nothing into it.

| # | Check | Result on failure | Fits with |
| --- | --- | --- | --- |
| V1 | **Inventory is a launcher inventory.** Validate against a new `docs/contracts/repository-inventory.json`: `schemaVersion`, `repositories[].id` as an `owner/name` slug, no unknown top-level keys, and a declared `status` per entry. Shape-alike documents are refused. The same validator replaces `inspectInventory()`'s count-only rule for appoint's `--inventory` (`core.ts:237-249`, `:434-439`). | `violated` (inventory), whole bundle | **#1334**. Its expected behaviour, "refuse … and write nothing to the target repository", becomes a hard precondition of apply. It lands as migration step 1, so the apply path is never built on the lax check. |
| V2 | **Plan and brief shape, one definition.** Launcher validates `plan.json` and the brief against the same contract Advisor uses. The drifted copies (`apply-plan.ts:26-131`) are removed. The brief's `context` is checked with Advisor's fixed-choice-id rule, and unknown top-level keys are refused (the #1178 review note). | `violated` | #1175, #1173 |
| V3 | **Authority is current and binds these bytes.** Recompute `plan.digest` canonically. For bundles with package acts, run execution readiness at the current instant (exit `0` required) and check `planDigest` equality. The union of the bundle's package acts must equal `permittedPackages`, and the repositories must be a subset of `permittedRepositoryIds`. For staffing-only bundles, see D2. | `violated` or `indeterminate`, keeping readiness's own ternary | #1178 step 1 |
| V4 | **The clone is the repository, and it is clean.** Origin matches the id (existing). `git status --porcelain` is empty; this check is new for siblings. The local default-branch head equals the remote's (read-only fetch). A missing clone is `indeterminate`, and cloning stays the explicit `--clone-missing` (#1179). | `indeterminate` (missing) or `violated` (dirty, mismatched) | #1179 |
| V5 | **Visibility and privacy.** Observe visibility. For a public target, apply the D4 rule to `problem`. Render the pull request text from ids and digests only, and scan it with the same identity rules as the brief. | `violated` | #1173, `AGENTS.md` "Conversation surface" |
| V6 | **Dry materialization.** Materialize into a temporary worktree, compute the digest, and regenerate the lockfile with `--ignore-scripts`. Check the lockfile invariants (SRI equality, no other top-level changes) and that every changed path is in `pathAllowList`. | `violated` | T7 |
| V7 | **Proof path exists.** For an `apply` phase, the base already carries Starter's caller workflow, and a request naming these exact packages. Otherwise the repository gets a `setup` phase set first. | Re-planned to `setup` | Starter, section 9 |

Only when V1 to V7 pass for a repository is its change set written to the
bundle as `planned`. `materialize` re-runs V3 and V4, because time and the
working tree may have moved since `plan`.

## 8. How the shared context (#1173) feeds the plan

- **Upstream, in Advisor.** `clossys/advisor/context.json` (business,
  product, audience, stage, intent, constraints; `context.ts:14-30`) is one
  of Advisor's inputs to composition and staffing. Apply never reads
  `context.json` itself and never asks the founder anything. Technical facts
  (package manager, lockfile present, workspace layout) are read from the
  clone during materialization, as #1173 requires ("technical facts … come
  from reading the repository, not from questions").
- **Into each repository, via the brief.** Each repository receives the
  context only as the brief's `context` snapshot, built by
  `toEngagementBrief()` (`engagement-brief.ts:55-89`). It holds fixed
  choice ids, never founder prose (`:97-119`). Roles in a product repository
  read it with `contextFromBrief()` (`:129`). Apply re-checks that rule at
  the write boundary (V2), which closes the review note on #1178.
- **Change propagation.** A context change changes the brief, which changes
  that repository's `after` hash, digest and branch. The next run proposes
  a brief-only refresh pull request and marks the older one `superseded`.
  There is no separate sync mechanism.
- **Never into pull request text.** Pull request titles and bodies carry
  ids, plan item ids, metric ids and digests only (V5). A context value is
  not repeated there even though it is a fixed id, so the public surface
  stays the minimum needed to review.

## 9. How the product repository standard (#1215) fits

#1215 defines what a well-formed product repository looks like
(`docs/contracts/product-repository-layout.json`: `clossys/`, `apps/*`,
`package.json` workspaces, `AGENTS.md`/`CLAUDE.md` pointers,
`.agents/skills`, `.github/workflows`). In this design it becomes the
**template for the `setup` phase** of a change set:

- **Owner column decides write rights.** Entries owned by
  `@clossys/launcher` (`clossys/`, `AGENTS.md`, `CLAUDE.md`,
  `.agents/skills`) are written or refreshed. Entries owned by `consumer`
  (`package.json`, `.github/workflows`, `apps/*`) are created only when
  absent and never overwritten. `apps/*` is not scaffolded by apply at all;
  application code is the agent's and Builder's work.
- **CI comes from the conforming template.** The workflow is composed from
  Controller's `conventions/templates/ci-workflow.yml` (named in a #1215
  comment; landed in #1275), plus Starter's caller workflow, a
  `.starter/request.json` naming the exact packages the following `apply`
  phase installs, and the path-scope job from section 5.
- **Post-materialize check.** `checkCloudSessionBootstrap()`
  (`packages/launcher/src/product-repository.ts:34-73`) must report `ready`
  on the materialized setup tree. That makes #1215's cloud-session bootstrap
  a verified outcome of setup, not a separate step.
- **Why setup is its own pull request.** Starter's trusted job runs from the
  protected base and reads the request from there
  (`caller-workflow.md:12-29`, `:141`). A pull request that introduces the
  request cannot be proved by it. So a repository's initial application is
  two pull requests: `setup` (layout, brief, skills, caller workflow and
  request; proved by the template CI), then `apply` (the exact package acts;
  proved by Starter). Later applications are one pull request per
  repository, as #1178 describes. This deviation from #1178's literal
  wording is D3.
- **Default staffing.** A v0 client has one product repository, and every
  staffed role staffs it (#1178 comment). So in the common case the bundle
  holds one repository, and #1178's "two pull requests" done-when is met by
  the fixture hub with two repositories.

## 10. Alternatives considered

**A. Launcher performs the whole loop, including push and pull request,
through the client's `gh`.** This is #1178 read literally. It gives the
strongest byte guarantee (no agent in between) and is consistent with
`gh repo create --push`. Its costs: it requires a local `gh` with push
rights, so it fails in the self-serve cloud-session path. It puts a
credentialed network write inside package code, which the fixture test
cannot exercise without a token or a fake. And it makes Launcher the
component that composes public text on a client's repository with no
agent or human in the loop before it posts. It remains the fallback if
owners judge T5's residual risk unacceptable. The change-set design keeps
that door open, because A is only the agent's column automated.

**B. A hosted service or GitHub App opens the pull requests.** It gives
central audit, retries, and works with no local tooling. Its costs: it
introduces a credential Clossys holds for client repositories, which
contradicts "the human holds intent and authority" (#1187) and the trust
statement (#1225). It is a hosted front door the owner has explicitly left
unscheduled (#1220 decision). It is also a new public attack surface. Not
recommended for M2.

**C. The agent applies the plan from skill guidance, with no change set.**
The skill tells the agent which versions to install and which files to
write. It is the cheapest to build. Its cost: nothing fixes or checks the
bytes, which is exactly what #1178 rules out ("exact versions and hashes
should never vary with phrasing"). A retried or resumed run can produce a
different tree. It cannot say `already applied` or `superseded` except
by the agent's judgement. Rejected.

**Recommendation: this proposal** (sealed change set, agent transport,
package verification on both sides). It meets #1178's determinism and
idempotency goals, keeps packages credential-free, and works on every
entry path. Alternative A stays available as an automation of the agent
column without redesign.

## 11. Migration plan

Each step is one pull request, lands in order, can be reverted alone, and
leaves `main` releasable. Nothing opens a pull request in a client
repository until step 4.

1. **Strict inventory and one plan contract** (Launcher, with a contract
   file). Add `docs/contracts/repository-inventory.json` and one
   `validateInventory()`. Use it for appoint's `--inventory`, which fixes
   #1334. Replace Launcher's drifted `validateAdvisorPlan` and
   `validateEngagementBrief` with the shared contract. Enforce the brief
   `context` rule and refuse unknown keys (the #1178 review note). Define the
   canonical plan digest in the contract. *Revert:* restore the old
   functions; no data format changes.
2. **Staffing, and a pure `plan` command in report mode** (Advisor adds
   `staffing` and `staffedHere` per the #1178 comment; Launcher adds
   `docs/contracts/repository-change-set.json` and a pure
   `planApplyBundle()`). `launcher-apply-plan plan` runs V1 to V7 against a
   fixture hub with two repositories. It writes only
   `clossys/.state/apply/` in the hub and nothing in any target. *Revert:*
   remove the subcommand; the hub file is inert.
3. **`materialize` and `verify`** (Launcher). Write the change set into a
   clean clone on the named branch, including the `setup` template from
   #1215 and the exact package acts. Regenerate the lockfile with
   `--ignore-scripts` under a sanitized environment, and check the
   invariants. The existing `--plan --brief --repo` invocation stays as a
   compatible alias for a brief-only set. *Revert:* remove the subcommands;
   still no remote effect.
4. **`status`, the rendered pull request body, and the agent procedure in
   the Launcher skill.** This is where live pull requests start, done by the
   agent. It adds the derived states of 4.4, the body marker, and the CI
   path-scope job in the Controller template. *Revert:* remove the skill
   section; any pull requests already opened are ordinary pull requests the
   client can close.
5. **Starter bootstrap end to end.** The setup set carries the caller
   workflow and request, and the apply set is proved by Starter. This meets
   #1178's done-when on the fixture hub: two repositories, two pull
   requests, Starter activation passing on both. *Revert:* the setup
   template drops the Starter files; apply falls back to template CI
   only.
6. **Revert sets and retirement.** Add `launcher-apply-plan revert` from
   `inverse`. Update the Launcher README ("Appoint does not install
   packages" stays true; "apply-plan does, through pull requests" is added)
   and the #1187 ownership row. *Revert:* remove the subcommand.

### Decisions needed from the owner

- **D1. Adopt the split in section 5.** Packages compute, materialize and
  verify; the client's agent branches, commits, pushes and opens the pull
  request; packages observe afterwards. The alternative is A (Launcher
  pushes through `gh`). Recommended: the split.
- **D2. What authorizes a staffing-only bundle** (brief, skills, layout, no
  package acts)? `ExecutionAuthorization` requires a non-empty
  `permittedPackages` (`authorization.ts:35`), so it cannot express one.
  Options: (a) extend the `plan.json` decision with a `subjectDigest` equal
  to the bundle digest, so "approved" binds bytes; (b) accept today's
  digest-free `chosen: "approved"` for staffing-only sets. Recommended: (a).
  Package acts always additionally require a current execution
  authorization.
- **D3. Two pull requests on a repository's initial application** (setup,
  then apply), because Starter proves from the protected base. The
  alternative is one pull request whose install goes unproved by Starter
  until a later pull request. Recommended: two, and one per repository
  thereafter.
- **D4. Public target repositories.** Refuse to commit the brief's
  free-text `problem` into a public repository (write a fixed placeholder
  that points to the hub), or allow it with explicit per-repository
  consent recorded in the plan. Recommended: refuse by default.
- **D5. Launcher's existing `gh repo create --push`.** Keep it as a
  documented exception, or move hub creation to the agent in a later
  Launcher version for consistency with D1. Recommended: keep, document,
  and do not extend.
- **D6. Superseded pull requests.** Open a new branch and pull request per
  digest and close the old one, or push a new commit onto the existing
  branch. Neither force-pushes. Recommended: a new branch per digest, which
  keeps "one digest, one branch" true and makes `status` unambiguous.
- **D7. Lockfile policy.** Treat lockfiles as `derived` (semantic
  invariants: SRI equality, no other top-level changes), or require
  byte-identical lockfiles under a pinned npm version. Recommended:
  derived, with the npm version recorded in the change set for diagnosis.
- **D8. Where the plan and brief contracts live.** Launcher currently has
  no runtime dependencies. Options: (a) JSON contract files in
  `docs/contracts/` that both packages validate against, packed into each
  package at build time as other contracts already are; or (b) Launcher
  depends on `@clossys/advisor` and imports its validators. Recommended:
  (a). It keeps Launcher dependency-free and makes the contract the one
  definition, where today there are two drifted copies.
