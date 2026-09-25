# RFC: apply an approved plan as one pull request per repository

- **Status:** draft, awaiting owner decisions. Documentation only: this file
  changes no code, contract, workflow or gate.
- **Tracking issue:** #1178 (the delivery layer). Interacts with #1334
  (inventory validation), #1173 (shared engagement context), #1215 (product
  repository standard), #1175 (plan file contract), #1179 (clone on approval),
  #885 (Integrator's currency and provenance gate) and the client-journey
  tracker #1187.
- **Read against:** `origin/main` at `53d5ef68` for sections 1 to 11, and at
  `b0503d1a` for section 12. `git diff 53d5ef68 b0503d1a` is empty for
  `packages/launcher`, `packages/advisor`, `packages/starter`,
  `packages/integrator` and `docs/contracts`, so every `file:line` below
  holds at both commits.

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
   repository's CI checks that the pull request touches only the declared
   paths, and Starter proves the install once it is in the base, one merge
   later (section 12.3).

This keeps the grooming principle ("packages own the deterministic
mechanics; the client's agent makes the live changes"). It amends it in one
way: an agent step with no verification on both sides would let phrasing
change the bytes, and #1178 exists to rule that out.

A client does not install once. They update, re-plan, add and remove
repositories, remove packages, and edit what was installed.
**[Section 12](#12-the-client-lifecycle-install-update-remove-repair)**
extends the design to that whole lifecycle with one model: a change set is
always *desired state minus installed state*. Installed state is a ledger
committed in each repository, joined to change sets the hub keeps, and
checked against the tree on every run. The flow owns only bytes it wrote,
and changes them only while they are still the bytes it wrote. A removal or
repair refuses a file the client has edited; it never overwrites it.
[Section 13](#13-decisions-needed-from-the-owner) lists every owner
decision, D1 to D20.

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
- **G8.** The same model serves every later run. An update, re-plan,
  removal or repair is a change set computed the same way, reviewed the
  same way, and verified the same way as an initial install (section 12).
- **G9.** No run ever overwrites or deletes bytes the flow did not write,
  or bytes the client has changed since the flow wrote them.

### Non-goals

- Deciding what to install. That is Advisor's job, and Advisor stays pure
  (`packages/advisor/README.md:5`).
- Merging. The client merges. #1187 states that "approval is a merged pull
  request in the client's own repository".
- Cross-repository atomicity. GitHub offers none; section 6 designs for
  independent pull requests instead.
- Deploying, provider CLIs, or application code (`apps/*`). These stay with
  the agent and Builder (#1211).
- Judging package currency and provenance. That is Integrator's job
  (#885). Apply consumes Integrator's findings (section 12.4) and adds only
  a read-only check of the files and keys it owns (section 12.6).
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
| T4 | **Replay.** A stale or superseded approval is used again, or an old change set is re-pushed after the plan has changed. | Resume, or copying a bundle to another hub. | The change-set digest covers the plan digest, the base commit, the ledger generation it starts from, and the file set. It does not cover the authorization (section 12.3), so re-approving the same bytes keeps the same branch. `verify` re-runs execution readiness at the current instant, so an expired or superseded grant refuses. Branch names and pull request markers carry the digest, so a stale set is recognized as `superseded`, never merged over a newer one. |
| T5 | **Tampering between verify and push.** The agent, or anything in its session, edits files after `verify` or adds an unrelated commit. | The agent step. | `status` compares the pushed head tree with the digest after the fact. The CI path-scope check refuses undeclared paths. The digest is shown in the pull request body, so the client can see which bytes they are approving. Section 5 argues that this is enough; alternative A is the stronger option if it is not. |
| T6 | **Privacy leak into a public repository.** Founder prose appears in `clossys/brief.json` or a pull request body in a public repository. | Brief writing, pull request rendering. | Target visibility is observed (`gh repo view --json visibility`, read-only) before materializing. The brief is validated at the write boundary with Advisor's own context rule. For a public target, free-text `problem` is refused unless the owner decides otherwise (D4). Pull request text is rendered from fixed ids and digests only, never from context or `problem`. |
| T7 | **Supply-chain substitution.** The installed tarball differs from the one approved. | Lockfile regeneration. | The change set pins `name@version#integrity` from `ImmutablePackageRef` (`types.ts:65`). `verify` checks that the regenerated lockfile's `integrity` for that package equals the plan's SRI, and that no other top-level dependency changed. Starter then re-proves the install in CI from the protected base. |
| T8 | **Mis-scoped inventory (#1334).** A foreign document is treated as the inventory. | `--inventory`, `externalInventory`. | Strict schema validation (section 7, V1). A `custom`-shaped external inventory stays `indeterminate`, as it already does (`packages/launcher/src/inventory-adoption.ts:59-67`). |

Later runs add threats T9 to T15: ledger forgery, clobbering client edits,
repository name reuse, update-time supply chain, downgrade replay, approval
fatigue, and removal mistaken for erasure. Section 12.9 covers them and the
changes to T2 to T7.

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
- `clossys/.state/apply/registry-snapshot.json`, fetched anonymously from
  the public registry by Launcher and turned into exact
  `name@version#sha512` package references by a pure Advisor function.
- `clossys/advisor/brief.json`, the engagement-level brief from
  `toEngagementBrief()` without `staffedHere`; Launcher projects it per
  repository (section 8).

### 4.2 `ApplyBundle`: one per application attempt

```json
{
  "schemaVersion": 1,
  "kind": "clossys.apply-bundle",
  "mode": "report",
  "plan": { "path": "clossys/advisor/plan.json", "digest": "sha256:<64 hex>" },
  "authorization": { "planDigest": "sha256:<64 hex>", "expiresAt": "2026-10-01T00:00:00Z" },
  "computedAt": "2026-09-24T12:00:00Z",
  "repositories": [
    { "id": "example-owner/product", "verdict": "satisfied", "phase": "setup",
      "changeSet": "sha256:<64 hex>", "checks": [] },
    { "id": "example-owner/docs", "verdict": "violated", "reason": "not-in-inventory", "checks": [] }
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

A bundle is `mode: "report"` or `mode: "planned"`
(`docs/contracts/apply-bundle.json`). A report bundle says what was
computed and what the pre-write checks found, and claims nothing about any
repository: no repository in it has a `state` or a `binding` (rule A5). In a
planned bundle, a repository that passed all of V1 to V9 and whose set an
approval binds carries `state: "planned"` and that `binding` (approved by
membership, or admitted under D26; rules A6 and A7); every other repository
carries neither. Neither `state` nor `binding` is inside `bundleDigest`, so
recording them never moves what the approval binds.

Each repository's own `verdict` is the worst of its checks — `satisfied`,
then `indeterminate`, then `violated` — and a computed repository with no
failing check is `satisfied` by default. A repository the plan staffs but
the bundle could not compute a change set for is `skipped`, carrying its
own `verdict` (`violated` or `indeterminate`) and a `reason` instead of a
change set. When the bundle's `authorization` names a `planDigest` that
differs from `plan.digest`, every computed repository in it carries check
V3 as `violated`, with rule `authorization-plan-mismatch`: the grant is
for a different plan, so nothing it permits can bind these bytes.

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
    { "path": "package-lock.json", "mode": "100644", "derived": true, "item": "wi-1",
      "invariants": [{ "item": "wi-1", "name": "@clossys/strategist", "version": "0.0.0", "integrity": "sha512-…" }] }
  ],
  "keys": [
    { "file": "package.json", "pointer": "/devDependencies/@clossys~1strategist", "before": null, "after": "0.0.0", "item": "wi-1" }
  ],
  "refused": [
    { "file": "package.json", "pointer": "/devDependencies/@acme~1lint", "reason": "client-edited", "item": "wi-2" }
  ],
  "deferred": [
    { "planItem": "wi-3", "reason": "after-setup" }
  ],
  "pathAllowList": ["clossys/**", ".agents/skills/clossys-*/**", "package.json", "package-lock.json"],
  "pullRequest": { "title": "Clossys: apply plan <12 hex>" },
  "inverse": "sha256:<digest of the derived revert change set>",
  "tooling": [{ "tool": "npm", "version": "10.9.2" }],
  "changeSetDigest": "sha256:<64 hex>"
}
```

Notes on the shape (`docs/contracts/repository-change-set.json`):

- `before` records the base content hash of each file. It makes the
  inverse change set derivable, and it detects a base that moved under a
  file the set touches.
- `derived: true` marks a file whose bytes are checked by `invariants`,
  never by byte equality, because they depend on tooling rather than only
  on what is installed. Only two files may ever be `derived`: the ledger
  (12.2) and the repository's own lockfile, whichever one its package
  manager writes. A lockfile's invariant is `{item, name, version,
  integrity}` — the exact package and SRI it resolves to — so the same
  rule checks `package-lock.json`, `pnpm-lock.yaml` or `yarn.lock` without
  the set naming a package-manager-specific path inside `node_modules`. A
  lockfile regenerated by a different npm minor version would otherwise
  break idempotency for no safety gain. See D7.
- `keys` writes one JSON-pointer entry inside a consumer-owned
  `package.json`, never the whole file, for the reason section 12.1 gives:
  the client's other keys never conflict with an update.
- `refused` lists every path or `package.json` key this set would have
  written but will not, and why — including a single pointer, not only a
  whole path. Its reasons are the fixed set section 12.1's ownership table
  produces, among them `client-edited`, the same reason the ledger check
  in 12.2 reports when the client's bytes no longer match what the flow
  last wrote. A set with a refusal writes nothing until the client
  chooses.
- `deferred` names a plan work item this set intentionally does not carry
  out this time, and why — so far only `after-setup`. A `setup` set
  authorizes no installs of its own, and this member is how it still
  accounts for every package act the plan grants the repository, instead
  of silently dropping one: a `setup` set defers every install the plan
  names, and the `apply` set that follows carries out or refuses each one
  it deferred (D3, section 9).
- `items[].planItem` links each act to a `FirstWaveWorkItem.id`, so the pull
  request can cite its plan items and metric targets (#1178 step 4) by id
  instead of by prose. Items are tied to what they write: an item marked
  `satisfiedInBase` (the plan already grants exactly this package, and the
  base already has it) writes nothing at all, and it is refused for the
  set to hold an `install` item inside a `setup` phase or a `deferred`
  entry inside an `apply` phase — the two phases partition every package
  act between "not yet" and "now," with nothing left over.
- `pathAllowList` may name only the patterns section 12.1's ownership
  table already grants the flow — Launcher's `clossys/` folder and
  composed skills, the agent pointer files, the Starter request, keys in
  `package.json`, the lockfile, a created-only-when-absent workflow, and a
  release-age surface. Every path this set touches, including a
  `package.json` key's file and the path an item like
  `exempt-release-age` names, must be matched by one of those patterns; a
  set cannot grant itself a new one.
- Every array whose order carries no meaning — `items`, `files`, `keys`,
  `refused`, `deferred`, `pathAllowList` among them — is written in one
  fixed order, so recomputing a change set from the same inputs always
  gives the same bytes and the same digest.
- The digest excludes timestamps, so recomputing from the same inputs gives
  the same set (G2).
- Every change set also writes the repository's ledger,
  `clossys/.state/installed.json`, and records the ledger generation it
  starts from. Section 12.2 defines both.
- An optional top-level `tooling` records the tool versions that
  materialized the set — the D7 diagnostic detail, for example which npm
  version regenerated the lockfile. It describes the machine, not the
  change, so it is excluded from the digest.
- The `changeSetDigest` excludes `changeSetDigest`, `branch`, `bundle`,
  the whole `pullRequest` member, `inverse` and `tooling`, and reduces
  every `derived: true` file to `{path, mode, derived, item, invariants}`.
  `pullRequest` is excluded whole, not only its body: the title itself
  carries the digest's first 12 hexadecimal digits, so both the title and
  the body (which carries the full digest as a marker) are computed from
  the digest, not inputs to it. Without these exclusions the shape is
  circular: the ledger cites this set's digest, the bundle digest covers
  every change-set digest, the pull request text carries the digest, and
  the branch name carries it too. Ledger and lockfile `after`/`before` are
  excluded for the same reason; their `invariants` stay covered
  (`docs/contracts/apply-change-set-digest.md`).

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
| `proved` | `applied`, and a Starter run returned `0` on a pull request whose base contains every `after` hash. Starter proves the base, so this lags `applied` by one merge (section 12.3). |
| `held` | The set was computed, but at least one path or key is refused because the client edited it, or an open pull request for this repository carries client commits (sections 12.5 to 12.7). Nothing is written until the client chooses. |

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
| Derive exact versions and SRI from the snapshot | Advisor (pure) | none | `advisor-resolve-packages` |
| Validate inputs and compute the bundle and change sets | Launcher | none; one anonymous read of the public registry (the registry snapshot fetch) | `launcher-apply-plan plan` |
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
  whose `before` was `null`. For package acts it inverts the act itself:
  `install` inverts to an exact `remove`, and `relocate` inverts to
  relocating back. The work item's declared `rollback` (`types.ts:67`,
  `:71`) is prose (`{ procedure, evidenceSource }`), so it is cited in the
  pull request, not executed. The revert is a normal pull request through
  the same verify, CI and merge path. The default branch is never rewritten.
- The stored `inverse` is valid only while the tree still holds every
  `after` hash. Once anything has changed since, the revert is recomputed
  from the ledger and the tree, and refuses client-edited paths (section
  12.5).

## 7. Validation before any live change

Everything below runs locally, read-only against GitHub, before a change set
may be materialized. A failure for one repository refuses that repository
only and writes nothing into it.

| # | Check | Result on failure | Fits with |
| --- | --- | --- | --- |
| V1 | **Inventory is a launcher inventory.** Validate against a new `docs/contracts/repository-inventory.json`: `schemaVersion`, `repositories[].id` as an `owner/name` slug, no unknown top-level keys, validated by `validateInventoryDocument()` (`packages/launcher/src/core.ts:335`); the per-entry `status` and immutable id arrive with inventory v2 (#1179). Until then the immutable id is observed at plan time and recorded in the change set (D19). This reverses the earlier requirement of a declared `status` per entry, which the landed v1 inventory contract refuses. Shape-alike documents are refused. The same validator replaces `inspectInventory()`'s count-only rule for appoint's `--inventory` (`core.ts:237-249`, `:434-439`). | `violated` (inventory), whole bundle | **#1334**. Its expected behaviour, "refuse … and write nothing to the target repository", becomes a hard precondition of apply. It lands as migration step 1, so the apply path is never built on the lax check. |
| V2 | **Plan and brief shape, one definition.** Launcher validates `plan.json` and the brief against the same contract Advisor uses. The drifted copies (`apply-plan.ts:26-131`) are removed. The brief's `context` is checked with Advisor's fixed-choice-id rule, and unknown top-level keys are refused (the #1178 review note). | `violated` | #1175, #1173 |
| V3 | **Authority is current and binds these bytes: approved by membership or admitted (D26).** Recompute `plan.digest` canonically. For bundles with package acts, run execution readiness at the current instant (exit `0` required) and check `planDigest` equality. The plan's `packages` must equal `permittedPackages` exactly (Advisor's own exact-equality rule, `authorization.ts:60`), and every package act in the bundle must be one of them; a plan package the base already satisfies exactly is recorded as a no-op item, not dropped, so a Starter pin one repository already has does not break the equality. The repositories must be a subset of `permittedRepositoryIds`. For staffing-only bundles, see D2. The set's digest must be a member of the bundle the latest committed decision approved, or the set must be admitted under D26 (rule L3, and rules A6/A7 for how a planned bundle records it). | `violated` or `indeterminate`, keeping readiness's own ternary | #1178 step 1 |
| V4 | **The clone is the repository, and it is clean.** Origin matches the id (existing). `git status --porcelain` is empty; this check is new for siblings. The local default-branch head equals the remote's (read-only fetch). A missing clone is `indeterminate`, and cloning stays the explicit `--clone-missing` (#1179). | `indeterminate` (missing) or `violated` (dirty, mismatched) | #1179 |
| V5 | **Visibility and privacy.** Observe visibility. For a public target, apply the D4 rule to `problem`. Render the pull request text from ids and digests only, and scan it with the same identity rules as the brief. | `violated` | #1173, `AGENTS.md` "Conversation surface" |
| V6 | **Dry materialization.** Materialize into a temporary worktree, compute the digest, and regenerate the lockfile with `--ignore-scripts`. Check the lockfile invariants (SRI equality, no other top-level changes) and that every changed path is in `pathAllowList`. | `violated` | T7 |
| V7 | **Proof path exists.** For an `apply` phase, the base already carries Starter's caller workflow, Starter pinned exactly at a version that implements #1492, and a request whose packages are installed in that base. The base is never required to pin `@clossys/advisor`. Otherwise the repository gets a `setup` phase set first. The set updates the request to name its own target, which Starter proves on the next pull request (section 12.3). | Re-planned to `setup` | Starter, section 9 |
| V8 | **Ledger and ownership.** The ledger at the default-branch head parses, joins to change sets the hub holds, and matches the tree on every path and key the set changes. Every write is compare-and-swap: the current bytes must equal the ledger's `after`, or be absent where the ledger has nothing. | `held` for the refused paths; `indeterminate` if the ledger cannot be read | Section 12.2 |
| V9 | **Provenance of every new version.** Each package version the set installs or updates to has registry provenance that Integrator verifies (`inspectProvenanceStatement`, #885). | `violated`, unless D20 allows the named first-publication exception | T12, section 12.4 |

Only when V1 to V9 pass for a repository is its change set written to the
bundle as `planned`. `materialize` re-runs V3, V4 and V8, because time, the
working tree and the default branch may have moved since `plan`.

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
  two pull requests: `setup` (layout, brief, skills, caller workflow,
  request, and an exact Starter pin; proved by the template CI),
  then `apply` (the exact package acts). Later applications are one pull
  request per repository, as #1178 describes. This deviation from #1178's
  literal wording is D3.
- **Correction from the lifecycle review.** The trusted job also *installs*
  from the base (`npm ci --ignore-scripts` on the base checkout,
  `caller-workflow.md:137-142`, `:161-163`) and checks installed identities
  in that directory (`packages/starter/src/node-runtime.ts:146-149`). So a
  Starter run on the `apply` pull request proves `setup`, and the `apply`
  install is proved on the next pull request after it merges. The same is
  true of every later update. Section 12.3 and D17 deal with this.
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
recommended.

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
   `clossys/.state/apply/` in the hub and nothing in any target. In this
   step V6 is a pure dry materialization of every non-derived file (brief,
   skills, owned `package.json` keys); lockfile regeneration and its
   invariants, and the setup-template bytes, arrive with `materialize` in
   step 3. A repository that needs `setup` is reported with V6
   `indeterminate` (`setup-template-unbuilt`) until then. *Revert:*
   remove the subcommand; the hub file is inert.
3. **`materialize` and `verify`** (Launcher). Write the change set into a
   clean clone on the named branch, including the `setup` template from
   #1215 and the exact package acts. Regenerate the lockfile with
   `--ignore-scripts` under a sanitized environment, and check the
   invariants. The ledger (section 12.2) ships in this step, as a file of
   every change set from generation 1. An initial install without it would
   leave the client with an install no later run can safely update. The
   existing `--plan --brief --repo` invocation stays as a compatible alias
   for a brief-only set. *Revert:* remove the subcommands;
   still no remote effect.
4. **`status`, the rendered pull request body, and the agent procedure in
   the Launcher skill.** This is where live pull requests start, done by the
   agent. It adds the derived states of 4.4, the body marker, and the CI
   path-scope job in the Controller template. *Revert:* remove the skill
   section; any pull requests already opened are ordinary pull requests the
   client can close.
5. **Starter bootstrap end to end.** The setup set carries the caller
   workflow, the request, and an exact Starter pin. Starter
   activation then passes on each apply pull request, proving the merged
   setup state; each apply install is proved on the next pull request
   (section 12.3). This meets #1178's done-when on the fixture hub: two
   repositories, two pull requests, Starter activation passing on both. *Revert:* the setup
   template drops the Starter files; apply falls back to template CI
   only.
6. **Revert sets and retirement.** Add `launcher-apply-plan revert`,
   from `inverse` while the tree still matches it and recomputed from the
   ledger otherwise (section 12.5). Update the Launcher README ("Appoint
   does not install packages" stays true; "apply-plan does, through pull
   requests" is added) and the #1187 ownership row. *Revert:* remove the subcommand.

## 12. The client lifecycle: install, update, remove, repair

Sections 1 to 11 describe a plan's initial application. A client then
comes back: a package has a new version, they re-plan, they add or rename a
repository, they drop a role, or they edit what was installed. This section
covers every later run with the same change set, the same `verify` and
`status`, and the same agent step. Sub-sections 12.4 to 12.7 answer the
four lifecycle questions. 12.8 and 12.9 give the failure modes and the
threat-model deltas.

### 12.1 One model: desired state minus installed state

For each repository:

- **Desired state** is computed from the approved plan, the inventory
  entry, the pinned templates, and the exact package references. It is
  what sections 4 to 9 already compute.
- **Installed state** is the ledger at the default-branch head (12.2),
  checked against the tree.
- **The change set is the difference**, path by path and owned key by
  owned key. A first install is the case where installed state is empty.

Every write is compare-and-swap. The flow changes a path only when its
current bytes equal what the ledger says the flow last wrote, or when the
path is absent and the ledger has nothing for it.

| Ledger says | Tree has | Desired says | Result |
| --- | --- | --- | --- |
| nothing | absent | present | **add** (`before: null`) |
| nothing | present | present | **refuse the path** (`unowned-existing`). The flow never takes ownership of bytes it did not write. A consumer-owned path in the #1215 layout is skipped with a note instead. |
| `after = h` | `h` | changed | **update** (`before: h`) |
| `after = h` | `h` | absent | **remove** (`after: null`) |
| `after = h` | other bytes | anything | **refuse the path** (`client-edited`). The repository is `held` (4.4). See 12.5 and 12.6. |
| `after = h` | absent | present | **drift** (`deleted`). Repair is offered (12.6), never folded silently into an update. |
| `after = h` | `h` | same | no-op |

**What the flow owns.**

- **Whole files** for paths the #1215 layout gives to `@clossys/launcher`
  or `@clossys/advisor`: `clossys/brief.json`, `AGENTS.md`, `CLAUDE.md`,
  `.agents/skills/clossys-*`, `clossys/README.md`, and machine files under
  `clossys/.state/` (`product-repository-layout.json:8`, `:43`, `:50`,
  `:57`; `consumer-layout.json:35-40`, `:97-103`).
- **Keys, not files,** inside consumer-owned `package.json`
  (`product-repository-layout.json:36`): the JSON pointer of each exact pin,
  for example `/devDependencies/@clossys~1writer`. The client's other keys
  never conflict with an update.
- **Invariants, not bytes,** for the lockfile (D7).
- **Created-only-when-absent files,** such as the Starter caller workflow
  under consumer-owned `.github/workflows` (`:64`). The ledger records the
  bytes the flow created. A later update touches such a file only while it
  still holds those bytes.

Ownership is recorded as digests in the ledger, never as markers inside
files. JSON has no comments, a marker changes the bytes it describes, and a
client can copy one into a file the flow never wrote (D10).

The precedent is already in Launcher. `shouldRefreshConsumerAgents()`
overwrites `AGENTS.md` only when it is absent or holds text Launcher is
known to have generated (`packages/launcher/src/core.ts:923-929`). The
ledger generalizes that rule from a few known texts to every file the flow
writes.

### 12.2 Installed state: the ledger

Each target repository carries `clossys/.state/installed.json` (D9). Every
change set writes it as one of its `files`, so it changes only through a
merged pull request. The hub keeps every change set it has materialized,
content-addressed and append-only, under
`clossys/.state/apply/change-sets/<digest>.json`.

```json
{
  "schemaVersion": 1,
  "kind": "clossys.installed-ledger",
  "repository": { "id": "example-owner/product", "nodeId": "R_<opaque>" },
  "generation": 2,
  "history": [
    { "generation": 1, "changeSet": "sha256:<setup>", "phase": "setup", "planDigest": "sha256:<plan>",
      "bundle": "sha256:<approved bundle>", "baseCommit": "<40 hex>",
      "binding": { "kind": "approved", "subjectDigest": "sha256:<approved bundle>" } },
    { "generation": 2, "changeSet": "sha256:<apply>", "phase": "apply", "planDigest": "sha256:<plan>",
      "bundle": "sha256:<later bundle>", "baseCommit": "<40 hex>",
      "binding": { "kind": "admitted", "subjectDigest": "sha256:<approved bundle>", "setupChangeSet": "sha256:<setup>" } }
  ],
  "files": [
    { "path": "clossys/brief.json", "mode": "100644", "after": "sha256:…", "changeSet": "sha256:<setup>" },
    { "path": ".claude/skills/clossys-writer", "mode": "120000", "after": "sha256:…", "changeSet": "sha256:<setup>" }
  ],
  "keys": [
    { "file": "package.json", "pointer": "/devDependencies/@clossys~1writer", "value": "0.4.1", "changeSet": "sha256:<apply>" }
  ],
  "entries": [],
  "packages": [
    { "planItem": "example-owner/product:@clossys/writer", "act": "install", "name": "@clossys/writer", "version": "0.4.1", "integrity": "sha512-…",
      "placement": "devDependencies", "changeSet": "sha256:<apply>" }
  ],
  "deferred": []
}
```

`history[].binding` records on what authority each generation was written
(D26, rule L3). Each `packages` and `deferred` row's `planItem` is the
repository id, a colon and the package name, exactly and in the same letter
case (rule L10) — never a plan work-item id. `packages` lists every package
act in effect, including one the base already satisfied; `keys` lists only
the keys the flow wrote. `deferred` holds the installs the latest setup set
deferred, with the plan's identity for each, so the apply set can be
compared with them without the plan. `entries` holds each release-age
exemption entry the flow added (D25).

- **Where "installed" truth lives.** For packages, the truth is the
  manifest and the lockfile. Integrator already reads both formats and
  reports an unreadable lockfile as `indeterminate`, never as "nothing
  installed" (`packages/integrator/README.md:268-301`). The ledger does not
  repeat that truth. It records which keys the flow put there, at which
  value, and for which plan item. For files, the ledger records which paths
  the flow wrote and the hash it wrote.
- **How the ledger is trusted.** It is a claim, not evidence. `status`
  trusts a row only when all of these hold:

  | Check | On failure |
  | --- | --- |
  | The ledger parses against its contract. | `indeterminate` (`ledger-unreadable`). Never read as an empty install. |
  | Every `changeSet` digest is one the hub holds, and the row's `after` appears in that change set's `files`. | The row is ignored as unowned (`ledger-foreign-row`). This is T9. |
  | `generation` equals the length of `history`, and the last entry is the change set of the last merged apply pull request that `status` observes. | `indeterminate` (`ledger-chain`). |
  | `repository.nodeId` equals the observed repository's immutable id. | `indeterminate` (`identity`). This is T11. |

  The ledger's own protection is the client's default-branch protection:
  it only changes by a merge the client made.
- **States stay derived.** `docs/LIFECYCLE.md` forbids declared state. The
  ledger records what the flow wrote, not whether it is still there or
  still healthy. Every state in 4.4 is still derived by comparing the
  ledger, the tree and the pull requests on each run.
- **Repositories Launcher touched before the ledger.** Appoint already
  composes skills into sibling checkouts and records a `sha256` per skill in
  `clossys/.state/skills.json` (`packages/launcher/src/skills.ts:199-205`),
  but nothing reads that digest back. A first apply to such a repository
  runs an adoption pass. It adopts, as generation 0, only files whose
  current bytes provably match flow output: a skill whose bytes match its
  `skills.json` digest, and an `AGENTS.md` that `shouldRefreshConsumerAgents()`
  recognizes. Everything else is unowned. Adoption writes nothing on its
  own; it rides in the generation-1 change set and is reviewed with it.

### 12.3 First install, tightened

The lifecycle view changes five things in sections 4 to 9.

1. **The initial change set writes generation 1 of the ledger** (migration
   step 3). If an initial install shipped without it, every early client
   would later hold an install that no run could safely update or remove.
2. **The flow never takes ownership of bytes it did not write.** A product
   repository that already has its own `AGENTS.md` or `.agents/skills`
   entry gets `unowned-existing` for that path (12.1). The path is reported
   and left alone. The setup pull request says so.
3. **Starter proves the base, so proof lags one merge.** Starter's trusted
   job checks out the pull request's base, runs `npm ci --ignore-scripts`
   there, and checks installed identities in that directory
   (`packages/starter/documents/caller-workflow.md:137-142`, `:161-163`,
   `:181-186`; `packages/starter/src/node-runtime.ts:146-149`). A Starter
   verdict on any pull request is therefore a verdict on the base's
   installed packages, joined to that pull request's evidence files. Three
   consequences:
   - `setup` must pin Starter exactly, at a version that verifies the
     hub-issued approval carried by the pull request (#1492), because
     Starter validates its own identity from the base — at most one
     `pin-starter` act may target a repository, and it always places the
     pin in `devDependencies` (R10, `docs/contracts/advisor-plan.json`).
     Advisor is not pinned in a product repository, and neither is
     Integrator: its engine is pinned once in the hub, and a product
     repository that needs an Advisor bin runs
     `npx --package=@clossys/advisor@<the hub's exact version> <bin>`
     (D24, D23). The Starter pin is a package act, so it needs a work item and
     an execution authorization. It is not implied by the template, and a
     staffing-only bundle (D2) cannot carry it. This reverses the earlier
     text in this bullet and in sections 9 and 11, which had Starter's
     request naming and validating both pins.
   - Each change set that changes a pin the request names (Starter or the
     target) also updates `.starter/request.json`. The Starter run on that
     pull request proves the *previous* state. The new state is proved on
     the next pull request after merge. `status` reports `applied` until
     then, and `proved` after (4.4).
   - The request has one `target` (`packages/starter/README.md:58-64`). In
     a repository with several pinned packages, one is Starter-proved. The
     others are covered by the lockfile invariants (V6), provenance (V9)
     and the template CI. D17 asks whether that is enough.
4. **The change-set digest excludes the authorization.** Section 3 had the
   digest cover the grant's `expiresAt`. A grant expires no later than its
   assessment basis (`packages/advisor/src/authorization.ts:57`), so a
   repeat user re-approves often. If the digest covered the grant, every
   re-approval of the same bytes would open a new branch and supersede an
   identical pull request. `verify` still checks the grant at the current
   instant, so nothing is weaker. The T4 row now says this.
5. **The bundle digest is defined without the authorization, too.** It is
   the digest of the plan digest and the sorted repository change-set
   digests. D2's `subjectDigest` binds that value. That removes a loop in
   which the approval would have to contain its own result. D26 binds per
   repository (installed-ledger.json's BINDING; rule L3): a later run whose
   bundle digest differs only because a sibling moved on to its apply set
   still binds each set that is a member of the approved bundle, and admits
   the apply set that follows each setup set.

### 12.4 Updates

Three things can make a later change set necessary. Each has one detector,
one path into Advisor, and one output: a change set computed by 12.1.

| Trigger | Detected by | Reaches the plan as | Change set contains |
| --- | --- | --- | --- |
| **(a) A new version of an installed package** | Integrator's `judgeCurrency` over the repository's own manifest and lockfile (`packages/integrator/src/currency.ts:166`). `behind` carries a `severity` of `patch`, `minor` or `major` (`:45`). | A `stale` placement cell with `expectedVersion` and `expectedPlacement` (`packages/advisor/src/types.ts:76`). Advisor maps `stale` to an `install` act (`packages/advisor/src/assessment.ts:77`). | The owned key's new value, the lockfile (derived), the request's target if it is the Starter-proved package, the ledger. |
| Same, for skills | Launcher's health report already counts catalogue skills older than the running Launcher (`packages/launcher/src/manifest.ts:77-90`). | No plan change. Skills are Launcher-owned output, not a package act. | A skills-only refresh of the owned skill files, as a normal reviewed pull request. |
| **(b) The client re-plans** | Advisor reassessment: `scope-change`, `evidence-change`, `initiative-change`, `readiness-change` or `sponsor-request` (`types.ts:63`). | A new plan with a new `planDigest`, so a new authorization (`authorization.ts:54`). | Only the difference from the ledger. An unchanged repository is a no-op. A package the new plan drops is a `remove` act. A repository dropped from `staffing` gets a removal set for its brief and skills (12.5). A context change is a brief-only refresh (section 8). |
| **(c) The inventory changes** | Read-only observation (table below) and #1216's drift report, which Launcher already runs on every apply (`packages/launcher/src/core.ts:1180-1183`, `packages/launcher/src/inventory-adoption.ts:50-85`). | Inventory edits go through the strict V1 validator in the hub. Staffing a new repository is a re-plan, as (b). | Depends on the event (below). |

**From Integrator to Advisor.** Advisor already accepts placement cells
from "a consumer connector" and does not read the tree itself
(`packages/advisor/README.md:31`). That connector is not built. This RFC
places it in Launcher, as a pure function, because the hub is the side that
knows repository ids. Integrator's blindness rule forbids it from holding
any (`packages/integrator/README.md:118-126`). The mapping:

| Integrator state | Placement cell | Advisor act |
| --- | --- | --- |
| `behind` | `stale`, `expectedVersion` = the exact version the plan chooses | `install` |
| `extra`, `opted-out-and-installed` | `over-install` | `remove` |
| `absent-without-reason` | `missing` | `install` |
| `indeterminate`, `unreachable`, `unauthenticated` | none; the repository is `indeterminate` | none |

Integrator reports "latest". A plan never installs "latest" by name. It
names an exact version and SRI, as every work item already must
(`types.ts:65`, `:71`), and V9 checks that version's provenance.

One shape hazard: Integrator's `emitCurrencyDelta()` writes a
`schemaVersion: 1` document with a `repositories` array and calls it
"launcher-consumable" (`packages/integrator/src/delta.ts:3-20`, `:112-124`).
That is exactly the shape #1334 showed Launcher accepting as an inventory.
V1 must refuse it as an inventory, and the connector must read it only as
a currency delta.

**Inventory events.**

| Event | Observed by | Action |
| --- | --- | --- |
| Repository added | The inventory gains an id that passes V1. | Nothing is written until a re-plan staffs it. It then gets the initial-install path (setup, then apply). |
| Repository renamed | `gh repo view <id> --json nameWithOwner,id` returns a different name for the same immutable id. Launcher already calls `gh repo view` per entry and discards the answer (`core.ts:893-921`). | A hub-only inventory update, proposed for approval. Target change sets stay `indeterminate` (`renamed`) until it merges. The flow never writes through a redirect, because a new repository can later take the old name (T11, D19). |
| Repository archived | `gh repo view --json isArchived` | `indeterminate` (`archived`). No pull request is possible. The ledger stays as history. Unarchiving resumes with a drift check. |
| Repository transferred to another owner | Owner no longer matches the hub. Launcher already skips such entries (`core.ts:986-988`). | Released: the flow stops managing it. Nothing is written. |
| Repository removed from the inventory | The id is gone after V1. | Released by default, not uninstalled (D18). The approval sheet offers a removal set as a separate, explicit item. |

**Keeping an update reviewable.**

- One pull request per repository per bundle, however many items it
  batches.
- The body lists each item by id with `from → to` and severity, and the
  ledger diff shows generation `n → n+1`. It is rendered from ids and
  digests only (V5).
- Unrelated drift is never folded in. A repair is its own line item
  (12.6) and can be declined.
- A downgrade is shown as a downgrade, never as an update (T13).

### 12.5 Removal

A removal is the inverse change set. The stored `inverse` from section 6 is
correct only while every path still holds its `after` hash. So a removal is
always recomputed from the ledger and the tree at the current head, with
the 12.1 table, where "desired" is absent.

| Path or key | Current bytes | Removal does |
| --- | --- | --- |
| Flow-created file (`before: null`) | equal to the ledger's `after` | Delete it. |
| Flow-changed file (`before: h0`) | equal to the ledger's `after` | Restore `h0`. |
| Owned key in `package.json` | equal to the ledger's `value` | Delete the key, or restore its earlier value; regenerate the lockfile (derived). |
| Any owned path or key | different from the ledger | **Refuse it** (`client-edited`). The repository is `held`. The client chooses: release it (the flow drops the ledger row and leaves the bytes), or restore it first (a repair set, 12.6), or leave the removal pending. |
| Any owned path | already absent | Drop the ledger row. Nothing to delete. |
| Role records and proof under `clossys/<role>/` | anything | **Never touched.** The flow did not write them; the role did. |

Three rules sit around the table.

- **Removal never deletes a client's work.** The client-edited case is a
  refusal, not a merge. A three-way merge would need judgement about what
  the client meant, and removal is the one place a wrong guess destroys
  data (D11).
- **Role records stay.** The consumer layout says "Removing a role removes
  its folder" (`docs/contracts/consumer-layout.json:16`). But those
  folders hold approved records and append-only proof
  (`consumer-layout.json:108-119`), which the role wrote over time, not
  the flow. The removal pull request lists them as left in place. D12 asks
  the owner to amend the layout rule to match.
- **Removal is not erasure.** Deleting a file in a pull request leaves it
  in history, and on a public repository that history is public. Removal
  cannot undo T6. That is why D4 refuses by default instead of relying on
  a later removal.

Launcher has one removal today, and it does not meet this bar. Skill
retirement deletes a composed skill that the previous `skills.json` named
without comparing its bytes to the recorded digest
(`packages/launcher/src/skills.ts:208-215`, via `removeComposedSkill()` at
`:157-164`). It also overwrites each composed skill unconditionally
(`:196`). A client who edited a composed skill loses the edit on the next
appoint run. Migration step 8 fixes this with the same compare-and-swap
check.

### 12.6 Drift and repair

**Who detects what.**

- Package drift (behind, extra, opted out but installed, missing, failed
  provenance) is Integrator's (#885). Apply consumes it through 12.4.
- Drift in the files and keys the flow owns is found by
  `launcher-apply-plan status`, read-only, from the ledger and the tree.
  Nothing else can find it, because only the ledger knows what the flow
  wrote.

**Classification.** The flow cannot know intent. It classifies by evidence
only.

| Observation on an owned path or key | Class | Repair |
| --- | --- | --- |
| Bytes equal the ledger | `clean` | none |
| Different bytes that still pass the file's own contract (a brief that validates, a skill that parses, a key with a valid exact version) | `client-edited` | **Never proposed on its own.** Reported. The client may release it, or ask for a restore. |
| Different bytes that fail the file's own contract (unparseable JSON, schema-invalid brief or ledger, a symlink where a file was, a changed mode) | `corrupt` | Proposed as a repair line item, if the path is a generated file. |
| Absent | `deleted` | Proposed for generated files. For `clossys/brief.json` it is reported, because deleting a brief can be a deliberate choice. |
| Lockfile integrity for an owned package differs from the plan's SRI | `integrity-mismatch` | **Never proposed.** It is a supply-chain signal (T7, T12). `status` reports `violated` and stops that repository. |
| A `clossys-*` skill or other file in an owned directory that no ledger row names | `unowned` | Never touched. Reported so the client knows it will not be updated. |
| Ledger unreadable, foreign row, or broken chain (12.2) | `indeterminate` | Nothing is inferred and nothing is written. |

**Repair is always a change set** (D13), computed by 12.1 with "desired" equal to
the ledger's last state, and delivered as a pull request through the same
verify, CI and merge path. The flow never writes to a default branch to
"fix" it.

**Never auto-repaired,** meaning never proposed unless the client asks, and
never bundled into an update:

- client-edited content that still passes its contract;
- anything consumer-owned: `package.json` beyond the owned keys, workflows
  after creation, and all of `apps/*`;
- role records and proof;
- lockfile integrity mismatches, which are escalated, not repaired;
- anything in a repository whose ledger is `indeterminate`.

### 12.7 Repeat-user approval

**What the client sees and approves.** Each bundle renders one approval
sheet from ids and digests only, never from context prose (V5).

| Column | Content |
| --- | --- |
| Repository | inventory id |
| Kind | `install`, `update`, `remove`, `refresh`, `repair`, `release` |
| Item | plan item id, or the owned path for a refresh or repair |
| Change | `from → to` version with Integrator's severity, or the path count |
| Carried over | whether this replaces an unmerged pull request (below) |
| Digest | first 12 hex of the change-set digest; the full value is in the pull request body |

One approval records two things together: D2's `subjectDigest` equal to the
bundle digest (12.3), and, when the bundle has package acts, the execution
authorization. Its packages and repositories must equal the plan's work
items exactly (`authorization.ts:58-61`), and those work items are the
bundle's package acts. Then the client merges each repository's pull
request. The merge stays the final approval, as #1187 says. It also admits
the apply set that follows each setup set in the bundle, under D26 (rule
L3), with no second approval.

**Batching.** Pending items collect until the client asks, or until
Advisor's reassessment cadence (`ReassessmentPolicy.cadenceDays`,
`types.ts:64`), per D15. One bundle then carries them all, with one approval and one
pull request per repository. The client may deselect items on the sheet.
Deselecting recomputes the bundle and its digest, so what they approve is
always exactly what is built. Two kinds of item do not wait for the
cadence: a failed provenance or integrity check, and an installed version
that Integrator cannot verify. Both surface at once as report-only
findings. They are not changes, so they need no approval to be seen.

**When an update overlaps an unmerged pull request from an earlier set.**

| Option | What happens | Problem |
| --- | --- | --- |
| **Supersede** | The new set is computed from the default branch, so it already includes whatever the earlier unmerged set did that the new plan still wants. It opens on a new branch (D6). The agent closes the old pull request with a pointer to the new one. | The client re-reviews a larger diff. The sheet marks the carried-over items, so the second review is short. |
| Stack | The new pull request is based on the old branch. | Starter's trusted job checks out the pull request's *base* (`caller-workflow.md:137-142`). A stacked base is an unprotected feature branch, so the "trusted" install would come from bytes nobody has approved. It also couples merge order. |
| Refuse | The new set waits until the old pull request is merged or closed. | Safe but slow. A client with one stale pull request stops getting updates. |

**Recommendation: supersede** (D14). One exception: if the old branch
carries commits the flow did not make (the client, or anyone, added work
to it), the repository is `held`. Closing that pull request would discard
their work. The sheet asks the client to merge or close it first.

**Avoiding approval fatigue without weakening the digest binding.**

- Fewer, larger, clearer asks: one approval per batch, not per package.
- No empty asks: a bundle with nothing to change is never shown.
- Severity is visible, so a patch batch reads differently from a major one.
- An expired approval over unchanged bytes keeps the same digest and the
  same pull request (12.3). The sheet says "same bytes, approval expired",
  so re-approving is one step with nothing new to read.
- **No standing approvals.** A rule such as "approve every patch update"
  would approve bytes nobody has seen, and Advisor's authorization cannot
  express it: packages must equal the approved items exactly
  (`authorization.ts:58-61`). D16 records this.

### 12.8 Failure modes

| Failure | Derived result | What happens next |
| --- | --- | --- |
| The client edited an owned file before an update or removal | `held` (`client-edited`) | Other paths still proceed if the client approves a partial set. Otherwise the repository waits. Nothing is overwritten. |
| The ledger is missing or malformed in a repository the hub has change sets for | `indeterminate` (`ledger-unreadable`) | No update, removal or repair. `status` offers a re-adoption pass (12.2), which is itself a reviewed change set. |
| The approval expired before the pull request opened | `violated` at `verify` | Re-approve. The digest and branch are unchanged. |
| A new version has no verifiable provenance | `violated` at V9 | The item is dropped from the bundle and reported. |
| The update merged but no later pull request has run Starter | `applied`, not `proved` | Shown on the sheet as awaiting proof (D17). |
| The repository was renamed or archived | `indeterminate` (`renamed`, `archived`) | Hub inventory update, or nothing. No writes through redirects. |
| An open pull request from an earlier set has client commits | `held` | The client merges or closes it first. |
| The client merged a partial or diverged pull request by hand | Derived from the tree: paths that match are `applied`, the rest `client-edited` | The ledger in that merge is checked (12.2). A ledger that does not match the tree makes the repository `indeterminate`. |
| Two hubs manage one repository | `indeterminate` (`ledger-foreign-row`) | Refused. A repository has one managing hub. |

### 12.9 Threat-model deltas

Changes to existing threats:

- **T2, blast radius.** A removal can do more damage than an install. The
  compare-and-swap rule (12.1) bounds a removal to bytes the flow wrote and
  the client has not changed.
- **T3, partial application.** Unchanged, but `held` joins the ternary as
  a named reason for a repository that is neither done nor failed.
- **T4, replay.** The digest now covers the starting ledger generation.
  A set computed against generation `n` is `superseded` once the ledger is
  at `n+1`. That blocks replaying an old set over a newer install.
- **T5, tampering.** Also applies to the ledger file, which is one of the
  set's `files` and is checked like any other.
- **T6, privacy.** Removal does not unpublish (12.5). The ledger carries
  paths, hashes and ids only.
- **T7, supply chain.** Updates are the main way a new version arrives, so
  V9 adds provenance to the SRI check.

New threats:

| # | Threat | Where it would enter | Mitigation |
| --- | --- | --- | --- |
| T9 | **Ledger forgery.** Someone adds a row claiming a client file, so a removal deletes it. | A commit to the ledger outside the flow. | A row is trusted only if its `after` appears in a change set the hub holds (12.2). A removal deletes only bytes that still equal that `after`. Forging a row gains nothing the flow did not already write. |
| T10 | **Clobbering client edits.** An update, removal or repair overwrites the client's changes. | Any write. | Compare-and-swap on every path and key (12.1). `client-edited` is refused, never merged. Existing skill retirement is fixed (12.5). |
| T11 | **Repository name reuse.** After a rename or deletion, a new repository takes the old name, and the flow writes there. | Inventory ids are `owner/name`. | The inventory and ledger also record GitHub's immutable repository id. Every run compares it. No writes through a redirect (12.4). |
| T12 | **Update-time substitution.** A compromised or mistaken release is picked up as an update. | 12.4 (a). | Exact version and SRI in the plan, provenance verified by Integrator (V9), severity shown, human approval per batch. |
| T13 | **Downgrade replay.** An older set, or a plan naming a lower version, rolls a package back to a known-bad release. | Resume, re-plan. | The generation check (T4). A lower version is labelled as a downgrade on the sheet and in the body, and needs its own item. |
| T14 | **Approval fatigue.** Frequent asks train the client to approve without reading. | 12.7. | Batching, severity, no empty asks, no standing approvals. The residual risk is accepted: the merge is still a human act on exact bytes. |
| T15 | **Silent loss of management.** A rename, transfer or inventory edit drops a repository without anyone noticing, and it stops receiving updates. | 12.4 (c). | Every inventory event is reported by name, and a release is an explicit line on the sheet. |

### 12.10 Migration additions

These extend section 11. The ledger is not deferred: it lands with step 3.

7. **Integrator-to-Advisor connector** (Launcher, pure). Map Integrator
   states to placement cells (12.4). Add V9 using Integrator's exported
   provenance join. Refuse a currency-delta document as an inventory (V1).
   *Revert:* remove the function; updates fall back to hand-written plans.
8. **Compare-and-swap everywhere** (Launcher). Apply the 12.1 rule to
   `materialize`, to `revert` (recomputed, 12.5), and to appoint's existing
   skill composition and retirement (`skills.ts:196`, `:208-215`). Add the
   adoption pass (12.2). *Revert:* restore the old write path; ledgers
   already written stay valid.
9. **`status` drift classes, repair and release** (Launcher). Add 12.6's
   classes, repair sets and release sets. *Revert:* remove the subcommands.
10. **Approval sheet and supersede rule** (Launcher skill and rendering).
    Render the sheet, the bundle digest of 12.3, and the D14 supersede
    procedure in the agent's fixed skill steps. *Revert:* remove the
    rendering; bundles still work one approval at a time.

## 13. Decisions needed from the owner

D1 to D8 are unchanged in number and substance. They moved here from the
end of section 11, and D2 and D3 each gained one sentence from section
12.3. D9 to D20 are new and come from section 12.

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
  authorization. The bundle digest excludes the authorization (12.3), and a
  `setup` set is never staffing-only, because it pins Starter.
- **D3. Two pull requests on a repository's initial application** (setup,
  then apply), because Starter runs from the protected base. The
  alternative is one pull request whose install goes unproved by Starter
  until a later pull request. Recommended: two, and one per repository
  thereafter. Section 12.3 found that Starter proves any install one merge
  late, so two pull requests are needed to give Starter a base to run
  from, not to prove `apply` on its own pull request.
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
- **D9. Where installed state lives** (12.2). Options: (a) a ledger
  committed in each target at `clossys/.state/installed.json`, joined to
  change sets the hub keeps; (b) a ledger in the hub only; (c) no ledger,
  recomputed from plan history and the tree. Recommended: (a). It changes
  only by a merge the client made, and it travels with the repository. With
  (b), the hub's record and the repository can disagree with no merge to
  show why, and a second clone of the hub has no record at all. With (c),
  nothing can tell a file the flow wrote from one the client wrote, so no
  removal is safe.
- **D10. How ownership is recorded** (12.1). Options: (a) digests in the
  ledger: whole files for Launcher- and Advisor-owned paths, JSON-pointer
  keys inside `package.json`, invariants for the lockfile; (b) ownership
  markers inside the files. Recommended: (a). With (b), JSON files cannot
  carry a marker, a marker changes the bytes it describes, and a copied
  marker would make the flow claim a client's file.
- **D11. Removal of a client-edited file** (12.5). Options: (a) refuse that
  path and offer release (stop managing it, keep the bytes) or restore;
  (b) delete it anyway; (c) three-way merge. Recommended: (a). With (b),
  the flow destroys client work. With (c), the flow guesses what the client
  meant, in the one operation where a wrong guess loses data.
- **D12. Role records when a role is removed** (12.5). Options: (a) leave
  `clossys/<role>/` records and proof in place, list them in the removal
  pull request, and amend the consumer-layout rule "Removing a role
  removes its folder" to say generated files only; (b) delete the folder as
  the rule says today. Recommended: (a). With (b), a removal deletes
  approved records and append-only proof that the flow never wrote.
- **D13. What repair may be proposed without the client asking** (12.6).
  Options: (a) only deleted or contract-invalid generated files, each as a
  separate line item; (b) any drift on an owned path. Recommended: (a).
  With (b), an update keeps offering to undo the client's deliberate edits,
  which is both fatigue and a clobbering risk.
- **D14. An update that overlaps an unmerged earlier pull request** (12.7).
  Options: supersede, stack, or refuse. Recommended: supersede, and hold
  the repository instead when the old branch has commits the flow did not
  make. Stacking makes Starter's trusted base an unapproved branch.
  Refusing stalls every later update behind one stale pull request.
- **D15. Batching and cadence** (12.7). Options: (a) one approval per
  batch, at the client's request or at Advisor's reassessment cadence, with
  integrity and provenance failures reported at once; (b) one approval per
  update as it arrives. Recommended: (a). With (b), a client with several
  packages approves many times for the same review effort.
- **D16. Standing approvals for low-risk updates** (12.7). Options: (a)
  none; every batch is approved by its digest; (b) a standing rule, for
  example "patch updates of installed packages". Recommended: (a). With
  (b), the client approves bytes nobody has shown them, and Advisor's
  exact-equality authorization would need a new, weaker form.
- **D17. How a package change is proved by Starter** (12.3). Options: (a)
  accept that proof lags one merge, derive `proved` separately from
  `applied`, and file a follow-up for a Starter trusted run after merge to
  the default branch; (b) change Starter's caller workflow now, inside this
  work; (c) describe the apply pull request as Starter-proved. Recommended:
  (a). (b) widens this work into Starter's trust design. (c) is a state
  claimed ahead of its evidence, which `docs/LIFECYCLE.md` calls a defect.
  Part of (a): with one `target` per request, packages other than the
  target rely on V6, V9 and the template CI. The owner decides whether that
  is enough, or whether Starter's request should name several targets.
- **D18. A repository removed from the inventory** (12.4). Options: (a)
  release it (stop managing, leave its files) and offer removal as a
  separate, explicit item; (b) treat it as an uninstall. Recommended: (a).
  With (b), an inventory edit, which may be a mistake or a tidy-up, becomes
  a destructive change in a client repository.
- **D19. Repository identity** (12.4). Options: (a) record GitHub's
  immutable repository id alongside `owner/name` in the inventory, change
  sets and ledger, and compare it on every run; (b) keep `owner/name`
  only. Recommended: (a). With (b), a rename followed by someone taking the
  old name sends the next change set to the wrong repository.
- **D20. Provenance for installed versions** (V9, 12.4). Integrator's
  guarantee has one named exception: a package's owner-present first
  identity publication carries no provenance
  (`packages/integrator/README.md:51-60`). Options: (a) require verified
  provenance for every version a set installs or updates to, and allow the
  first-publication exception only on a first install, with SRI, labelled
  on the approval sheet; (b) require it with no exception; (c) SRI only.
  Recommended: (a). With (b), a brand-new package can never be installed.
  With (c), an update can pick up a release that was not built by the
  publish workflow.

D21 to D26 are new. Unlike D1 to D20, these arrived from the owner already
decided, not as open options.

- **D21. Version policy.** Each package resolves to the public registry's
  `latest` dist-tag when the registry snapshot is taken. Prerelease and
  deprecated versions are refused. The exact version and its sha512
  integrity are bound into the approval.
- **D22. Freeze after approval.** From the approving decision until every
  repository in the bundle is applied, or the plan is re-made, Advisor
  changes nothing the plan digest covers. Progress is derived by `status`
  (4.4), never written into the plan. The plan digest definition (4.2) is
  unchanged.
- **D23. Integrator placement for V9.** `@clossys/integrator` is pinned
  exactly once, in the hub, next to `@clossys/advisor` (D24). The apply
  step runs `integrator-provenance-check` from the hub against each
  materialized repository, after the lockfile is regenerated (V9). The
  check reads the manifest, the lockfile and the public registry; it does
  not need Integrator installed in the repository it checks. A product
  repository's own CI runs the hub's exact version with
  `npx --package=@clossys/integrator@<the hub's exact version>
  integrator-provenance-check`, and pins nothing. Advisor and Integrator
  are the two roles the plan contract's own `hubOnlyRoles` data names as
  hub-only (`docs/contracts/advisor-plan.json`): a mandate may name either
  without staffing it in any repository, and a staffing entry that names
  one is refused before the plan is even valid enough to digest (R11).
- **D24. Advisor bins in product repositories.** Invoke them as
  `npx --package=@clossys/advisor@<the hub's exact version> <bin>`. The
  package has no bin named after itself. This is the same shift the
  amendments to section 9, section 11 and section 12.3 already make:
  Advisor is pinned once, in the hub, never per product repository, for
  the same `hubOnlyRoles`-and-R11 reason as Integrator (D23).
- **D25. Release-age exemption.** Every `@clossys/*` package installed in a
  consumer is exempt from any minimum-release-age window, because
  Integrator verifies its provenance (D23). The setup step writes the
  exemption into whichever release-age surface the repository uses.

- **D26. One approval per first install.** Decided by the owner. The
  founder approves once: the approving decision's `subjectDigest` is the
  digest of the bundle that holds each staffed repository's `setup` change
  set (or its `apply` set, when its base is already set up). A later `plan`
  run binds each repository's set on its own. A set whose digest is a member
  of the approved bundle is **approved**. An `apply` set is **admitted**,
  with no second approval, if and only if all three of these hold:

  1. **Same approved plan.** It is computed from the same approved plan
     digest, the approving decision is still the latest committed one
     (D22), and the execution authorization is current.
  2. **Same authorized package acts, and no other change.** Its package
     items equal, act for act and byte for byte, the setup set's package
     items and deferred entries; it defers nothing; it has the same
     `producer` (the same Launcher version); and it writes nothing but those
     `package.json` keys, the lockfile and the ledger, so every other file
     it names is unchanged.
  3. **Its base contains the merged setup, shown by content.** The ledger at
     its `baseCommit` ends with that setup set's digest, bound to the
     approved bundle, and every byte the setup set wrote is present there.
     Ancestry is not used, because a squash or rebase merge leaves no
     ancestor commit.

  Any other set waits for a new approval. An expired authorization, a moved
  base under an unmerged setup set, or a different `producer` each still
  needs the founder's approval of the recomputed bytes.

  Launcher checks all three in V3, before `materialize` and again at
  `verify`, because only the hub holds the decision and the bundles. Each
  generation of the installed-state ledger
  (`docs/contracts/installed-ledger.json`) records its binding: `approved`
  with the approved bundle's `subjectDigest`, or `admitted` with that same
  `subjectDigest` and the setup set's digest, and an admitted generation must
  come directly after its approved setup generation, from the same plan
  (rule L3). That `subjectDigest` need not equal the entry's `bundle`:
  `bundle` records the run that computed the set, and a later run's bundle
  differs whenever a sibling repository's set has moved on to its own
  `apply` set, while this set is still a member of the approved bundle.

  Starter re-checks the admission in the repository's own trusted CI job
  (#1492), from the protected base's ledger and the pull request's ledger,
  comparing each by its exact canonical bytes rather than any other
  schema-valid spelling of it: the pull request's ledger is the base's plus
  one admitted generation that installs exactly the packages the setup
  deferred and changes no other row. That comparison can report one of
  three results: no new generation, an admitted generation it has proved, or
  a claimed approval. A claimed approval is never authenticated by a reader
  without the hub, so Starter refuses a head whose last generation labels
  itself `approved` on an apply pull request instead of `admitted`, or
  treats that pull request as one needing the client's own review. Starter
  cannot see the private hub, so it authenticates no decision beyond that
  comparison. No Starter request and no other whole file carries the
  approval, because every whole file is inside the digest the approval
  names; the ledger is derived, outside that digest, so it can.

  There is no second Clossys approval. The agent requests auto-merge once
  `verify` passes, and, for the apply pull request, once Starter's admission
  check is also green. The repository's own branch protection still governs
  the merge, so a repository that requires a human review keeps it.

### Noted for step 3

These are gaps the built contracts surfaced, not owner decisions. Each is
for migration step 3 (section 11), `materialize` and `verify`, to close
when it makes the acts below real.

- The write binding for the five acts no package computed, the
  `agents-pointer` and `claude-loader` records, the composed-skill manifest
  and the host discovery links is code rule C9 of
  `docs/contracts/repository-change-set.json`; C11 requires a setup set to
  be complete, and C12 binds the release-age exemption to its surface and
  scope.
- The hub skeleton still pins only Advisor. Adding Integrator's exact pin
  next to it remains part of step 3, and D23's placement needs it.
- Decided by the owner: appoint stops composing skills into product
  checkouts, so skills reach a product repository only through a setup or
  apply pull request, as a compose-skills item with its discovery links and
  `clossys/.state/skills.json` (C9). Appoint still composes into sibling
  checkouts until step 3 changes it.
