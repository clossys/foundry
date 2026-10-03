# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.5.0 - 2026-10-03

- Allow an explicit agent namespace for apply branches, covered by the change-set digest and setup path-scope checks.

## 0.4.0 - 2026-10-02

- The packed brief contract names Launcher's `planApplyBundle()` as the one producer of a per-repository brief, in the present tense, and says it computes that brief without writing any file (#1178).
- Add `readHubAuthority()`, `planPackagesFor()` and `decideSetBinding()`, which decide a change set's approval binding from the hub's committed plan, its stored bundles and change sets, and the current execution authorization.
- `readHubAuthority()` refuses a hub whose head is not its branch's upstream (`hub-not-upstream`) and returns the `head` commit it read the plan from, and `decideSetBinding()` reads the assessment at that commit (`hub-head-moved` when the head has moved) and refuses an authorization whose permitted packages differ from the plan's packages (`packages-not-exact`) (#1628).
- Admission requires the hub branch's upstream to be a remote-tracking ref, so a local branch no longer qualifies, reads the head, its commit and its upstream in one git call, and compares each authorized package by name, version and integrity as one unit, so an entry with an empty name no longer collides with another (#1851).
- The apply planner now writes a Launcher-owned guide file inside `clossys/` that names `clossys/` and the `clossys-*` skills as Launcher-owned and carves that namespace out of the repository's own skill policy, owned by its ledger digest, and `verify` and `status` report a changed guide as `agents-guide-mismatch`.
- Add `launcher-apply-plan body --repo <id> --task-record <n> [--supersedes <n>]...`, which prints the pull request body for a stored change set and only that, decided from the hub's own approval at the time of the run, and records the SHA-256 of the bytes it printed as the change set's `pullRequest.bodySha256` (a body already bound to another hash is refused as `body-bound`, and a planned bundle holding another approval as `binding-mismatch`). `renderPullRequest` takes an optional `supersedes` list of distinct pull request numbers, written ascending under `## Supersedes`, refused as `supersedes-invalid` otherwise; `body` needs another stored change set of the repository for it (#1178).
- `validateApplyBundle()` refuses a bundle that records a registry snapshot and no authorization unless every computed repository carries the violated V3 `authorization-absent` check, and refuses that check in any other bundle (#1178).
- `validateApplyBundle()` requires an authorization for a planned bundle's binding only when its plan has package acts; a plan with none is bound by its approving decision alone (#1178).
- `planApplyBundle()` reports a change set that fails validation by its position in the plan's staffing, not by its position among the sets that were computed (#1178).
- `validateApplyBundle()` accepts a `planned` bundle, in which a repository that passed all nine pre-apply checks and is bound by an approval carries `state: "planned"` and its `binding`, and refuses a state or binding in a report bundle, a state without all nine checks satisfied, a binding without a satisfied V3 check, an `admitted` binding on anything but an apply set or naming the bundle's own digest, two different approvals in one bundle, and a binding in a bundle whose plan has package acts (its `snapshot` is not null) but that carries no authorization. `planApplyBundle()` still writes report bundles only (#1178).
- `validateApplyBundle()` refuses a bundle in which a repository's verdict is not the worst of its checks, or the authorization-mismatch check is missing or present when it should not be (#1178).
- `applyEngagementBrief()` also refuses a plan that does not validate, and its applied result carries the plan's canonical digest, which `launcher-apply-plan` prints (#1475).
- `launcher-apply-plan --help` says it is the brief-only path, which checks no approval binding and accepts an approval with or without a `subjectDigest` (#1178).
- launcher-apply-plan materialize writes a stored change set into the repository's local clone, and verify reports whether that clone matches the set.
- `launcher-apply-plan` reports a repeated key in a plan or brief file by its 1-based position in its object and that object's position -- "the top-level object" for the document's own object, else the character position it starts at -- never by the key's name (#1178).
- `launcher-apply-plan` refuses, with exit `2`, a plan or brief file that is not valid UTF-8, starts with a byte order mark, or repeats an object key at any depth, and reports a JSON syntax error by position only, without quoting the file's text (#1475).
- `launcher-apply-plan status` now compares the pull request's body with the change set's stored `bodySha256`: a pull request is `proposed` only when `sha256:` and the SHA-256 of its body's UTF-8 bytes, exactly as GitHub returned it, equal that hash, and is otherwise `diverged` (`body-mismatch`, also for a body that is not well-formed UTF-16). A change set with no `bodySha256` is `indeterminate` (`body-unbound`). The body is checked after the base branch, branch and title and before the head, only this set's own pull request is hashed, and neither hash nor body is printed (#1178).
- Add `launcher-apply-plan status --repo <id>`, which reports from read-only evidence whether the pull request for a stored change set is proposed, applied, superseded, diverged or indeterminate, checking the pull request's head commit with `verify`'s own checks without fetching or checking it out. It needs a full clone: a partial (promisor) clone is refused as `indeterminate (partial-clone)` before any object is read, its git calls run with lazy fetch off and a time limit, a corrupt or unreadable object or a hung call is `indeterminate`, and a listing of 100 or more open pull requests is refused. `verify` now reports `removal-present` (exit 1) for a present but unreadable file at a removed path instead of raising (#1178).
- A hub store now keeps each change set and bundle under clossys/.state/apply/ by digest, and reads one back only when its recomputed digest matches its name.
- `launcher-apply-plan materialize` and `verify` now refuse, writing nothing, unless the plan committed at the hub's branch head approves a bundle that holds the change set, or the set is an apply set admitted under the one-approval rule; the ledger records the binding the hub decided.
- Appointing over a stored inventory that fails its contract now tells the founder to choose the hub's repositories on Advisor's repository card and run `launcher --repositories <owner/name>[,<owner/name>...] --replace-inventory`, instead of to fix the file or supply `--inventory <path>` (#1179).
- Appoint now keeps the `name` already in a repository's `package.json` and names a `{owner}/workspace` checkout `@owner/workspace` only when its manifest has no name (#1585).
- Appointing a repository with no inventory now tells the founder to choose the hub's repositories on Advisor's repository card and pass them to `launcher --repositories`, instead of pointing at `--inventory <path>`, which still works (#1179).
- Appointing a hub now refuses a `package.json` that is a symbolic link before writing anything, so the engine pins can no longer be written through a link to a file outside the checkout.
- `approvedSubject(plan)` is added. It returns the `subjectDigest` of the plan's latest decision (by `at`) when that decision chose `"approved"`, and otherwise `null`: when the plan does not validate against the plan contract, when it has no decisions, when its latest decision is not an approval, when that approval has no `subjectDigest`, when decisions tied at the latest instant disagree or name different subjects, or when a decision time does not parse (#1178).
- Binding a pull request body to a stored change set now refuses a second bind of the same set that runs at the same time, and a set removed while it is being bound, instead of storing one of two hashes or recreating the set.
- `checkCloudSessionBootstrap()` notes, when a product repository has no `AGENTS.md`, that a launcher run in the hub writes nothing there and that it arrives with the setup pull request of an approved plan that staffs the repository.
- `validateEngagementBrief()` checks a brief's `context` snapshot against the engagement-context contract, so a known value must be one of that field's fixed choice ids (#1475).
- `validateEngagementBrief()` accepts every goal direction Advisor's brief contract lists, including `maintain` and `target-range`, and accepts an empty `sequence` (#1475).
- `validateEngagementBrief()` refuses an empty string in `inputsFrom`, `outputsTo`, `sequence` or `deliverables`, which it previously accepted (#1475).
- `validateEngagementBrief()` accepts an optional `staffedHere` list, and refuses one that names a role not in the brief's `roles` or names a role twice (#1178).
- `validateEngagementBrief()` still refuses a whitespace-only `problem`, `role`, `why` or goal `metric`, now through the shared brief contract (#1475).
- New `bundleDigest()` computes the digest an approval binds: the canonical digest of the plan digest and, sorted by id, the id and change-set digest of each repository that has a change set, and nothing else (#1178).
- Running `launcher-apply-plan plan` again on an unchanged hub no longer fails with `store-failed`: the apply-bundle store keeps the newest computation under a bundle digest, replacing that one file atomically when the clock or the committed execution authorization changed (the digest does not cover them), while the change-set store stays append-only (#1178).
- New `canonicalDigest()` returns `sha256:` and the hex SHA-256 of any value's RFC 8785 canonical JSON; `planDigest()` now computes through it and gives the same digest for every plan as before (#1178).
- `validateRepositoryChangeSet()` refuses a change set whose items, files, keys, refusals, deferrals, invariants, path allow-list, release-age surfaces or tooling are not in the contract's canonical order (#1178).
- `validateRepositoryChangeSet()` refuses a change set that marks any file derived other than the installed-state ledger and the repository's own lockfile, because a derived file's bytes are outside the change-set digest (#1178).
- New `changeSetDigest()`, `changeSetDigestSubject()`, `CHANGE_SET_DIGEST_EXCLUDED_FIELDS` and `DERIVED_FILE_DIGEST_FIELDS` compute a repository change set's digest, which leaves out `changeSetDigest`, `branch`, `bundle`, `pullRequest`, `inverse` and `tooling`, and reduces each derived file to its `path`, `mode`, `derived`, `item` and `invariants` (#1178).
- A change set's whole file has mode `100644`, or `120000` for a discovery link, and a derived file has mode `100644`; `100755` is refused (#1178).
- A change set records the hub's exact Integrator pin as `integrator`, covered by its digest, and `planApplyBundle()` takes that pin as a new required input (#1178).
- `validateRepositoryChangeSet()` refuses a change set in which a key, a lockfile invariant, the brief file, a skill file or a refusal does not match the item it names: a package item satisfied in the base that still writes or is refused, one not satisfied that neither writes nor is refused, a key or invariant that is not its item's package, or a refusal naming the ledger item. Items of the acts no package computes yet are not checked against their files (#1178).
- A change set records which of `.agents`, `.agents/skills` and each role's skill directory is a symbolic link on the default branch as `observed.linkedAgentsPaths`, covered by its digest, and `validateRepositoryChangeSet()` refuses a set that writes a skill under one; such a skill must be refused with the new reason `skills-root-is-link` (#1178).
- A change set's `observed` records whether the default branch has a workflow of its own (`consumerCi`) and which of `.claude/skills` and `.cursor/skills` is a symbolic link there (`symlinkedSkillRoots`), both covered by its digest; `RepositoryObservation` requires both (#1178).
- A change set may own no file under `.github/workflows/` except a workflow named `clossys-*`, and never `.npmrc` (#1178).
- `validateRepositoryChangeSet()` refuses a change set with a `pin-starter` item placed anywhere but `devDependencies`, or with more than one `pin-starter` item (#1178).
- `validateRepositoryChangeSet()` refuses a package item whose `planItem` is not exactly the repository id, a colon and the package name, and a deferral whose `planItem` is not the repository id, a colon and a package name, because a `planItem` is written into the installed-state ledger, which may be public (#1178).
- `validateRepositoryChangeSet()` refuses a refusal that names the ledger item, or a key refusal for another package than its item's (#1178).
- A change set can refuse a path as `deleted`, `release-age-surface-conflict` or `release-age-surface-unparseable` (#1178).
- `validateRepositoryChangeSet()` refuses a release-age exemption whose file is not its surface's (`pnpm-workspace.yaml` or `.yarnrc.yml`), whose surface the repository's package manager does not read, or whose scope is not the publishing scope this package was built with; `.npmrc` is no longer an exemption surface, because npm has no exemption key (#1178).
- `validateRepositoryChangeSet()` refuses a change set that lists the same refused path or key twice (#1178).
- A change set's compose-skills roles must be lowercase id tokens, because a role becomes part of paths the installed-state ledger records (#1178).
- A change set records the Controller repository profile the default branch declares as `observed.repositoryProfile` (its path, whether it has a root vocabulary Controller checks, and the root names the set introduces that it does not declare or prohibits), covered by its digest, and `validateRepositoryChangeSet()` accepts a `declare-root-entry` item that adds each undeclared name to that profile as an allowed extension. It requires the item exactly when the profile needs it, binds it to exactly that profile and those names, and requires a refusal with the new reason `root-vocabulary-unknown` for an unreadable profile, or the new reason `root-entry-prohibited` for one that prohibits a name the set introduces. Only a path the set creates introduces a root name, never a refused path, a key's file or an edited file, and each name is one of the fixed root names an owned pattern can introduce (#1178).
- `validateRepositoryChangeSet()` refuses a setup set that lacks exactly one each of the caller workflow, Starter request, CI template and path-scope job, and one Starter pin, or that has a release-age exemption when its package manager is npm or none, or none when it is pnpm or Yarn (#1178).
- New types for the apply planner, change sets and bundles, among them `PlanApplyBundleInputs`, `RepositoryObservation`, `RepositoryChangeSet`, `ChangeSetItem` and `ApplyBundle` (#1178).
- `validateRepositoryChangeSet()` gives every act a write kind and checks each whole file against it in one rule (C15): no act deletes a file; a discovery link is only created or kept; a release-age exemption file is created or changed, never left as it was; and a Controller profile edit changes a file the default branch has, never creating or deleting it (#1178).
- `validateRepositoryChangeSet()` ties each discovery link (only for a role whose skill the set writes), the composed-skill manifest, the `AGENTS.md` and `CLAUDE.md` records (by path; their bytes are not checked here) and each setup template act to exactly the files it writes, requires mode `120000` exactly for a discovery link and the link's content to be its target, and lets a release-age exemption write at most its own file (#1178).
- `launcher-check` reads an optional `integratorVersion` string from the captured observation, and grades a create or appoint observation without one as indeterminate (exit 2).
- When Launcher runs in an empty directory and clones an existing `{owner}/workspace` repository, it now classifies the clone's hub marker like a local run: a current marker resumes, a legacy `.clossys/` marker is migrated, both markers are refused, and a clone with no marker is appointed as the hub. Appoint refuses a `package.json` that is unreadable or not a JSON object before it writes anything, so a refusal leaves the checkout unchanged (#1585).
- `--clone-missing`'s reported note is fixed text (`cloned beside the hub`, or `gh repo clone exited <status>`) instead of the cloned folder name or `gh`'s own stderr, so it no longer repeats the repository id either (#1179).
- A contract message reports a field the contract does not declare at the object that holds it, by its 1-based position in that object, never by its name (#1178).
- The packed conversation contract says "the role's status file" where it previously named the status file by its file name, and "the role-loop archetypes that `@clossys/controller` ships (see its README)" where it previously cited `contracts/role-loop-archetypes.json`, a path the Launcher package does not contain (#1500).
- `applyEngagementBrief()` computes the plan digest before it writes, and returns a refusal rather than throwing, so a refusal never leaves `clossys/brief.json` behind (#1475).
- `reportInventoryDrift()` takes the hub's owner as an optional fifth argument and compares ids with the same identity as the rest of Launcher, so an external `app` and the hub's `<owner>/app`, or ids that differ only in letter case, agree instead of appearing on both sides. Every `launcher` run passes the hub's owner (#1179).
- `reportInventoryDrift()` reads the hub's own inventory with `validateInventoryDocument()`; when that inventory is present but invalid the report is `indeterminate`, naming why, instead of comparing the external inventory against an empty list (#1179).
- The inventory drift notes name the declared `externalInventory` without printing its `path`, including in the `indeterminate` note for an unreadable document or an unmapped shape (#1179).
- `reportInventoryDrift()`'s `externalOnly`, `launcherOnly` and `agreeing` fields are each a count plus every entry's position (`externalInventory[<i>]`, the declared external document's own `repositories` array index, and `repositories[<j>]`, the hub's stored inventory's array index) instead of the repository ids themselves (#1179).
- A declared external inventory that is not valid UTF-8, repeats a key, or starts with a byte order mark is now reported as unreadable (`inventory drift: indeterminate`) instead of being read after silent repair (#1179).
- When resume or appoint changes an engine pin in the hub's `package.json`, the run names each change (`engine pins changed in package.json: ...`, `health.enginePins.changed`) and the next step: run the hub's package manager install, then commit `package.json` together with its lockfile.
- An `@clossys/integrator` pin found in `dependencies`, `optionalDependencies` or `peerDependencies` moves to `devDependencies`, as an `@clossys/advisor` pin does, and every other `@clossys/*` entry stays as it is.
- Resume and appoint raise an engine pin that is older than live, or not a plain version, to the live version, and keep a pin that is newer than live.
- `CLOSSYS_OWNER` that names the origin's owner in another letter case is accepted instead of refused as a different account (#1179).
- `launcher` refuses (exit 1) instead of printing usage (exit 0) when `--inventory`, `--repositories`, `--replace-inventory`, or `--clone-missing` is given in a directory that is not empty, not a git repository, and not an existing hub -- a bare `launcher` there still prints usage, since that is someone finding out what the command does, not a request it cannot satisfy (#1179).
- `launcher-apply-plan status` now refuses a clone as partial when a remote records a `partialclonefilter` or has a space in its name, and two overlapping `status` calls in one process leave the git environment variables as they found them. The pull request body renderer accepts package item ids up to the 355 characters the change-set contract allows. The `body` help and README say that a mistaken binding has no way out and recommend `--body-file`, and the `plan` usage and README say which sheet rows planned mode adds.
- An apply set over a repository set up before the Launcher guide existed now adds the Launcher agents guide, and admission and the ledger's succession rule S3 accept that add when its row names the digest of the guide's bytes.
- The health report's `dualPin` is true when either hub engine is pinned in more than one dependency bucket.
- The health report's `extraClossys` lists the `@clossys/*` names other than the two hub engines, `@clossys/advisor` and `@clossys/integrator`.
- The health report is degraded when the hub has no `@clossys/integrator` pin in `devDependencies`.
- The health report carries `integratorPin` beside `advisorPin`, grades each engine against its own live version, and names the engine on each pin finding (`PinFinding.package`).
- The health report is degraded when the hub's stored inventory fails its contract.
- The health report lists each inventoried repository other than the hub as a `sibling` line and under `skillComposition.siblings`, which takes the place of `skillComposition.rosterSkipped`; for a checkout beside the hub, or one not cloned yet, the line says a hub run writes nothing there and that, once the repository is staffed in an approved plan, `@clossys-advisor` and the voices of the roles staffed there arrive with that plan's setup pull request.
- `WorkspaceHost` has two new required methods, `readBytes(path)` and `writeBytes(path, contents)`, which read and write a file's exact bytes. A caller that supplies its own host to `planWorkspace()`, `applyWorkspacePlan()` or the other host-taking functions must implement both (#1179).
- The hub's generated `AGENTS.md`, and the `README.md` a new hub starts with, say a launcher run writes nothing into a product repository and that a repository staffed in an approved plan gets `@clossys-advisor` and the voices of the roles staffed there with that plan's setup pull request, and resume replaces the earlier generated `AGENTS.md` text that said the team was composed in every checkout beside the hub.
- A hub marker whose `repository` names its `owner` in another letter case is read as a hub marker instead of being ignored (#1179).
- Creating or appointing a hub pins `@clossys/integrator` in `devDependencies` at its live registry version, as an exact version, beside `@clossys/advisor`.
- A launcher run (create, resume, or appoint) writes composed skills, the skills manifest, host discovery links and `AGENTS.md` into the hub only, and changes nothing in an inventoried repository's checkout beside the hub; a product repository receives those files only once it is staffed in an approved plan, with that plan's setup pull request.
- The hub leaves itself out of its own sibling roster by repository identity -- its origin's `owner/name`, or the repository its marker records when it has no github.com origin -- instead of by folder path. An inventory naming the hub in another letter case, such as `<owner>/Example-Hub` for a hub in `example-hub`, no longer composes the hub a second time as its own sibling on a case-insensitive file system, and no longer reports it as a missing clone on a case-sensitive one (#1179).
- The health report is degraded, with an `engine-pins-changed-install-needed` finding (`health.installNeeded`), while the hub has an npm lockfile that does not resolve each engine at its pinned version, or another lockfile and the run changed an engine pin.
- When a hub has both `npm-shrinkwrap.json` and `package-lock.json`, the install-needed check reads `npm-shrinkwrap.json`, as npm does.
- The install-needed check compares an engine pin with its locked version as versions, so a `v0.6.0` pin matches a locked `0.6.0`.
- `validateInstalledLedger()` refuses a files row for the ledger itself, `package.json` or a lockfile in any letter case (#1178).
- New `validateInstalledLedger()` validates `clossys/.state/installed.json` against the shared installed-state ledger contract, which this package now packs, including its code rules L1-L10: each generation's change set and approval binding (`approved` by the approved bundle's digest, which may be an earlier run's bundle than the one the set was computed in, or `admitted` right after the approved setup set it names, from the same plan and the same approved bundle), rows that name only the ledger's own generations, owned paths with the right mode for discovery links, keys that match packages, no act recorded twice, canonical order, every root entry in one Controller profile and among the fixed root names, roles in skill paths that are lowercase id tokens, and each planItem exactly the repository id, a colon and the package name, so no plan text reaches a public ledger. Unknown fields are refused and no reason echoes a value. A valid ledger is well formed, not trusted: trusting a row needs the hub's change sets, which this function does not read (#1178).
- Creating or appointing a hub refuses as indeterminate when the npm registry returns no readable `@clossys/integrator` version.
- An inventory Launcher copies rather than composes -- an `--inventory` document when appointing, and a legacy `.clossys/inventory.json` it migrates to `clossys/.state/` -- is written byte for byte, with only a final newline added when one is missing (#1179).
- `launcher --repositories`'s refusal names an added or removed repository only by its position (`--repositories[<i>]`, or `repositories[<i>] in the stored inventory`), never by its id (#1179).
- Doc comments and README prose in `@clossys/launcher` said `docs/contracts/repository-inventory.json` "is not shipped in this package," which reads as though this package ships no copy of the contract at all. It now says that exact monorepo path does not ship, but this package's build packs and ships its own copy of the contract -- true of no other contract this package validates against, which really do not ship in any form (#1179).
- An inventory whose strings hold a lone surrogate is now refused: an escaped one such as `"\ud800"` in a file (for example in a `packages[].name` or `version`, which was accepted before), and a raw one in a string passed to `validateInventoryDocument()`. It has no UTF-8 encoding, as the shared contract checker refuses it everywhere (#1179).
- When appointing merges an `--inventory` document into a populated stored inventory, Launcher now keeps each entry whole, `packages` included, instead of writing ids alone; treats ids that differ only in letter case as one repository, keeping the stored entry; and checks the merged document against the inventory contract before writing it (#1334).
- When appointing merges an `--inventory` document into a populated stored inventory, a bare id and `<owner>/<id>` for the hub's own owner now count as one repository, and the merge keeps the first occurrence (#1179).
- An appoint plan that merges an `--inventory` document into a populated stored inventory now also carries the merged document as `mergedInventoryDocument`, and apply writes that document (#1179).
- Every inventory file -- the stored `clossys/.state/inventory.json` on every run, an `--inventory` document, and a declared external inventory -- is now read as its exact bytes and handed to the shared strict reader. Before, it was decoded as text first, which silently replaced bytes that are not valid UTF-8 with U+FFFD, so such a file read as populated and `--replace-inventory` could write the replacement characters back. A stored inventory or `--inventory` document like that is now reported invalid, with the reason `is not valid UTF-8`; a declared external inventory like that makes the drift report indeterminate (#1179).
- Every inventory document is now checked by the same shared contract checker, packed from `@clossys/advisor`, that checks the plan and the brief, against `docs/contracts/repository-inventory.json` in that checker's schema form. The fields and their rules are the same; the values it now refuses that it used to accept -- a lone surrogate, and one repository listed twice under a bare and an owner-qualified id -- are stated in their own changesets. Refusals now name each field at fault by position, for example `repositories[0].role is not a field the contract declares` or `repositories[1].id names the same repository as repositories[0].id`, and no longer quote the refused id (#1179).
- An inventory document is now read as strict JSON: one that repeats a key in any object, is not valid UTF-8, or starts with a byte order mark is refused as invalid, and a JSON syntax error is reported by position only (#1179).
- The README and the doc comment of `isPlanApproved()` say that it binds no bytes -- it ignores `subjectDigest` -- and that anything that applies a plan must use `approvedSubject()` instead, the one stated exception being the legacy brief-only path, which predates the binding (#1178).
- `isPlanApproved()` returns false when any decision's `at` does not parse to a finite time, or when decisions at the same latest instant do not all say `approved`, instead of letting array order decide (#1475).
- New `serializeInstalledLedger()` returns a valid ledger's exact bytes: every object's members in the ledger contract's declared order, two-space JSON and one line feed. It throws for a ledger the contract refuses (#1178).
- `ledgerSuccession()`, `readInstalledLedger()` and `trustInstalledLedger()` now take the ledger's bytes as a `Uint8Array`, decoded with the same strict reader the plan and brief contracts use, rather than a caller-decoded string.
- `validateInstalledLedger()` accepts an `entries` row for each root entry the flow added to a Controller repository profile, and orders `entries` by file, then key, then value (#1178).
- New `ledgerSuccession()` compares a pull request's head ledger with its base's, each given as its exact bytes, under the ledger contract's succession rules. Both must be exactly the bytes the contract renders for them, so a repeated key, a byte order mark or another spelling is refused (`bytes`) and never read as unchanged. The head is either unchanged or exactly one next generation that keeps the base's history, and an admitted generation installs exactly the packages the base's setup set deferred and changes no other row. The result's `admission` is `admitted` only for an admitted generation every rule proved, and `approval-claimed` for an approved head generation, which a reader without the hub cannot authenticate and must not treat as a pass. It checks what the two ledgers claim, not the pull request's files (#1178).
- Launcher adds an internal lockfile regeneration module for npm and pnpm, run with install scripts off in an environment built from a fixed allow-list, and a checker that compares a regenerated lockfile with each approved package's version and integrity.
- `validateAdvisorPlan()` and `validateEngagementBrief()` refuse a string or object key that contains a lone surrogate, so every plan that validates has a digest (#1475).
- Materialize refuses a moved default branch without writing, stores the change set on a successful verify rerun, and computes ledger bytes before checkout (#1178).
- RepositoryObservation now takes the ledger's bytes and the base's composed-skill manifest in place of ledgerGeneration, and PlanApplyBundleInputs takes the hub's held change sets.
- observeRepository() turns one local clone into a RepositoryObservation read only from the default-branch head's git objects, or into a skipped observation with a reason id. A clone that is missing, has another origin, uncommitted changes or untracked files not ignored, a hidden edit, a submodule, an alternate object store, a split index, a local head that differs from the remote tip, or a .git/config key a plain clone does not carry is refused rather than observed, and git inside the clone reads no configuration but the vetted .git/config, so no filter or submodule in it is run.
- Two spellings of one GitHub account -- for example the signed-in login and the origin's owner in different letter case -- count as one owner candidate, so creating a hub no longer asks which of them should hold it (#1179).
- Each staffed repository's change set now composes the Advisor voice with the voices of the roles staffed there.
- `planApplyBundle()` carries every package act the plan names for a repository as an item of its change set, and adds no act the plan does not name (#1178).
- When the plan has package acts and no authorization is passed to `planApplyBundle()`, every computed repository in the bundle carries a violated V3 check with rule `authorization-absent`, so none is reported satisfied (#1178).
- When the authorization passed to `planApplyBundle()` names a different plan digest than the plan's, every computed repository in the bundle carries a violated V3 check with rule `authorization-plan-mismatch` (#1178).
- `planApplyBundle()` writes every change-set array whose order carries no meaning in the contract's canonical order, so the same observations given in any order produce the same change set and digest (#1178).
- `planApplyBundle()` refuses a discovery link path the default branch already has, as a file or a directory, as `unowned-existing` (#1178).
- `planApplyBundle()` takes which skill directories are symbolic links on the default branch, and refuses each skill under one as `skills-root-is-link` instead of writing it; `clossys/.state/skills.json` then lists only the skills it writes (#1178).
- In the bundle `planApplyBundle()` returns, a repository whose change set changes a lockfile carries V6 `indeterminate` with rule `lockfile-not-run`, because the planner checks the file layout only and does not regenerate the lockfile; V6 is `satisfied` only for a set with no lockfile change (#1178).
- The bundle `planApplyBundle()` returns is in report mode and records no repository state (#1178).
- `planApplyBundle()` throws, before computing anything, when a staffed role is not a lowercase id token (`role-not-an-id`) or a package act's `planItem` is not its repository id, a colon and its package name (`plan-item-not-derived`), so no plan text reaches a public ledger. A role that is not one path segment is no longer refused as `unsafe-path`; it is refused this way (#1178).
- `planApplyBundle()` takes each repository's observed Controller profile. It skips a repository whose profile needs root entries added as `root-entry-edit-unbuilt`, because it does not compute the edited profile's bytes yet, and refuses the declaration as `root-vocabulary-unknown` for an unreadable profile or `root-entry-prohibited` for one that prohibits a root name the set introduces (#1178).
- `planApplyBundle()` writes, for each staffed role whose `SKILL.md` it writes, a discovery link under `.claude/skills` and under `.cursor/skills` (mode `120000`, pointing at the role's composed skill), except under a root the default branch has as a symbolic link; a role whose skill is refused gets no link (#1178).
- `planApplyBundle()` writes `clossys/.state/skills.json`, listing the skills the set writes, with no time in it (#1178).
- `planApplyBundle()` skips a setup-phase repository as `setup-template-unbuilt`, with verdict `indeterminate`, and leaves it out of the bundle digest, because a setup set must now carry the setup templates, which the planner does not compute yet (#1178).
- `planApplyBundle()` refuses, as `unowned-existing`, any file it would write whole and any `package.json` key it would change that the default branch already has, comparing paths case-insensitively (#1178).
- New `planApplyBundle()` computes one change set per staffed repository in the apply phase, skipping one whose Controller profile needs root entries added (`root-entry-edit-unbuilt`), and a report-mode bundle from a plan, the hub brief and observations of each repository's default branch, and reads no file, network, process or clock (#1178).
- `validateAdvisorPlan()` accepts Advisor's blocker shape (`capabilityId`, `kind`, `owner`, `nextAction`, `since`) and a `recommendedNext` without `due`, and refuses the old `description` and `dueDate` blocker fields (#1475).
- `validateAdvisorPlan()` refuses a plan that breaks one of the plan contract's code rules R1-R8, naming the rule and the position of the field at fault, and `planDigest()` throws for such a plan; Launcher implements the rules separately from Advisor, and both are tested against one shared corpus (#1178).
- `launcher-apply-plan plan` computes the apply bundle for the plan file in the hub's working tree and reports on the sheet whether it is the committed one, stores its change sets and the bundle under `clossys/.state/apply/`, and prints an approval sheet of ids and digests only, ending in the `Approve subjectDigest:` line; it takes no approval or binding (#1178).
- `validateAdvisorPlan()` accepts an optional `delegatedCopyApproval` on a plan, `planDigest()` covers it, and the `AdvisorPlan` type declares it (#1586).
- New `planDigest()`, `canonicalJson()` and `PLAN_DIGEST_EXCLUDED_FIELDS` compute the same canonical plan digest as Advisor's (#1475).
- `launcher-apply-plan plan` now dry-materializes each repository whose set changes a lockfile in a temporary directory, so its sheet reports V6 (lockfile regeneration) and V9 (package provenance) instead of `lockfile-not-run`, without writing the clone (#1178).
- planApplyBundle() reads each repository's installed-state ledger, trusts rows against hub-held change sets and plan package acts (including deferred identities), refuses apply whole-file adds without a ledger row, and compare-and-swaps owned paths and keys.
- `validateAdvisorPlan()` refuses a plan whose `mandate.roles` names one role twice (the plan contract's code rule R9), even when the plan has no staffing; such a plan validated before and now has no `planDigest()`, and `launcher-apply-plan` and `applyEngagementBrief()` now refuse it (#1178).
- `validateAdvisorPlan()` refuses a plan with more than one `pin-starter` act for one repository, or a `pin-starter` act whose placement is not `devDependencies` (the plan contract's code rule R10) (#1178).
- `plan` writes a `planned` bundle when the hub's committed plan carries an approval whose bundle the hub holds: each repository's V3 is decided by the admission check, a bound repository with V1 to V9 satisfied is `planned` with its binding, and a stored planned bundle is never replaced by a report of the same digest (#1708).
- `validateAdvisorPlan()` refuses a plan that staffs a hub-only role (Advisor or Integrator) in any repository, naming rule R11 and the role's position. This includes an existing plan that already staffs `advisor` or `integrator`: Launcher now refuses it, and `planDigest()` throws for it, until the role is removed from its `staffing` (#1178).
- `validateAdvisorPlan()` no longer requires a hub-only role in `mandate.roles` (Advisor or Integrator, read from the plan contract's `definitions.hubOnlyRoles`) to be staffed in any repository: the plan contract's rule R2 exempts it (#1178).
- `validateAdvisorPlan()` and `advisorPlanViolations()` refuse a package act whose `planItem` is not its `repository`, a colon and its `name` (rule R12), so `planApplyBundle()` refuses such a plan when it validates the plan (#1550).
- `validateAdvisorPlan()` accepts four optional plan fields from the shared plan contract -- `kits`, `staffing` (roles per repository, by repository inventory id), `packages` (exact `install` or `pin-starter` acts, each with a lowercase scoped name of at most 214 characters, one exact version with at most 16 digits in each part and no prerelease or build suffix, and one canonical `sha512-` integrity value) and `resolution` -- and an optional `subjectDigest` on a decision (#1178).
- New types `PlanKit`, `PlanStaffing` and `PlanPackageAct`; `AdvisorPlan` gains the optional `kits`, `staffing`, `packages` and `resolution`, `PlanDecision` the optional `subjectDigest`, and `EngagementBrief` the optional `staffedHere` (#1178).
- `validateAdvisorPlan()` refuses a plan time that is not a real calendar time in ISO 8601 form (a date-time needs `Z` or a `±hh:mm` offset), checked field by field, so an out-of-range month, day, hour, minute, second or offset, or a day the month does not have such as `2026-02-30`, is refused (#1475).
- The exported `PlanBlocker` type has Advisor's blocker fields, `AdvisorPlan.recommendedNext.due` is optional, `EngagementBrief` has an optional `context`, and `EngagementContext`, `EngagementContextField`, `EngagementContextFieldId` and `GoalDirection` are exported (#1475).
- `planWorkspace()` takes a founder's chosen repositories through the new `PlanWorkspaceOptions` (`repositories`, `replaceInventory`), and its adopt or resume plan carries the resulting `ChosenInventory`: the exact document to write, or `unchanged` (#1179).
- A caller reading the report directly gets the same position labels as the printed message: `skillComposition.siblings[].inventoryId` carries `repositories[<i>] in the stored inventory`, and `reportInventoryDrift()`'s positions carry the plain `externalInventory[<i>]` or `repositories[<j>]` form (#1179).
- Add `renderPullRequest()` and `readChangeSetMarker()`, which render a change set's pull request title and body from ids, act names, versions and digests only, with one digest marker and a `## Task record` link, and read that marker back.
- New `projectEngagementBrief()`, `serializeEngagementBrief()` and `PUBLIC_PROBLEM_PLACEHOLDER` produce a repository's brief from the hub brief, with its staffed roles and, unless the repository is private, the brief contract's fixed placeholder in place of the problem, and the exact bytes written for it (#1178).
- The provenance gate (V9) now skips an `install` or `pin-starter` item only when its `satisfiedInBase` is exactly `true`; a missing, `null`, numeric or string value is gated like `false` instead of counting as already in the base (#1647).
- `checkSetProvenance()` reports, for one change set, whether each package version it installs or updates is verified by the hub's pinned Integrator, with no exception for an unverified package, so an unattested first publication blocks; `plan`, `materialize` and `verify` do not run it yet.
- `validateAdvisorPlan()` and `validateEngagementBrief()` refuse an array with holes (one built in code, such as `[a, , b]`; JSON never produces one), reporting it at the array as a sparse array, so no rule ever walks a hole (#1178).
- `registrySnapshotDigest()` is exported; it computes a registry snapshot's contract digest from the snapshot's contents.
- The registry snapshot step names a package in its messages only by its position in the request, `names[<n>]`, never by its name (#1178).
- A registry snapshot records, for each package the registry has, only the version its `latest` dist-tag names and, when the registry lists that version, that one version's integrity, tarball, deprecation, publish time and attestation presence, plus the SHA-256 of the response body's bytes as received (of the decoded body, if a server compressed it despite being asked not to). It is validated against the shared registry snapshot contract before it is written, and the same registry answers produce the same bytes apart from `fetchedAt` (#1178).
- New `launcher-apply-plan snapshot --request <file> [--out <file>]` takes the registry snapshot a plan's exact packages are resolved from. It reads the names in `advisor-package-request`'s report, refusing any name outside the publishing scope this package was built with, and writes the snapshot atomically to `clossys/.state/apply/registry-snapshot.json` under the current directory unless `--out` names another file. Exit `0` means the snapshot was written, or that `--help` printed the usage; `2` means nothing was written (#1178).
- The registry snapshot step reads each package's full registry document from the registry in the packed `package-scope.json` through Node's own `fetch`. The only headers this step sets are `accept` and `accept-encoding: identity`; Node's fetch adds its own default, non-credential headers. It sets no `Authorization` header, runs no npm CLI and reads no `.npmrc`. It asks for the body uncompressed, so when the server honours that, the 10 MiB cap and the recorded hash apply to the exact bytes received; otherwise they apply to the decoded body. It refuses redirects, stops reading a response once it passes 10 MiB (counting decoded bytes, if a server compresses anyway), and abandons a request after 30 seconds. A 404 is recorded as `not-found`; any other failure, status or non-JSON body writes no snapshot and exits `2` (#1178).
- `verifyReleaseAgeExemption()` confirms that an edited release-age exemption file differs from the original by that one entry. It returns false for an unchanged file and for a pnpm `.npmrc` that conflicts or has a line outside the fixed safe shape.
- `editReleaseAgeExemption()` adds the publishing scope's release-age exemption entry to a pnpm workspace file or a Yarn configuration file, or refuses a file shape it does not recognise, including a pnpm `.npmrc` with any line outside a fixed safe shape.
- The setup-flow tests now prove the release-age base digest on the verify and materialize paths, and a stale comment about the apply-set release-age item was corrected; there is no behavior change (#1675).
- renderInstalledLedger() gives the bytes of the ledger generation a change set writes, and refuses an apply set that would adopt a file.
- `--repositories` replaces a stored inventory that fails its contract only with `--replace-inventory`, and then writes the chosen ids alone (#1179).
- After `--replace-inventory` writes the new file, the success line labels each removed repository's position `repositories[<i>] in the replaced inventory`, distinct from the refusal's `repositories[<i>] in the stored inventory`, since the position indexes into the inventory as it stood before that run (#1179).
- `--repositories` never merges into or silently overwrites a stored inventory that lists a different set of repositories: it refuses, stating how many repositories each side has and which ids would be added and removed, unless `--replace-inventory` approves the replacement (#1179).
- When `--replace-inventory` replaces an inventory that lists a different set of repositories, a repository that stays keeps its existing entry, `packages` included (#1179).
- On an existing hub, `--repositories` writes the inventory before skills are composed and the health report is built, so the same run reports a repository the choice just added as a `sibling` line (#1179).
- `--repositories` together with `--inventory`, `--replace-inventory` without `--repositories`, and `--repositories` in an empty directory are each refused with exit 1 (#1179).
- New `--repositories <owner/name>[,<owner/name>...]` writes the repositories a founder chose on Advisor's repository card into `clossys/.state/inventory.json`, when appointing a repository as the hub or on an existing hub, so nobody hand-writes the inventory (#1179).
- `--repositories` leaves a stored inventory that already lists exactly the chosen repositories, in any order, as it is (#1179).
- The ids given to `--repositories`, and the document built from them, are checked against the inventory contract before anything is written; a malformed choice is refused by position, without quoting an id, and nothing is written (#1179).
- Launcher compares repository ids one way everywhere: a bare id names a repository of the hub's own owner, and letter case is ignored. A stored inventory, an `--inventory` document, or a `--repositories` choice that lists one repository twice this way, such as `app` and `<owner>/app`, is refused, naming the two positions, instead of being kept as two entries for one repository. `validateInventoryDocument()` and `inspectInventory()` apply that rule when given the hub's owner (`InventoryReadOptions`), and `readInventoryRepositories()` takes it as an optional fourth argument (#1179).
- The observation adapter no longer passes git's `GIT_TEST_*` switches to any git command, and passes `GIT_CONFIG_COUNT` and the numbered key and value variables to `git ls-remote` (and to no command inside the clone), so an origin that needs credentials through them is observed; the release-age editor refuses a pnpm `.npmrc` with a `userconfig`, `globalconfig` or `prefix` key as `release-age-surface-unparseable`.
- On an existing hub, `--inventory` is refused with a pointer to choosing the repositories again and running `launcher --repositories`, instead of an instruction to edit `clossys/.state/inventory.json` by hand (#1179).
- Resuming a hub pins `@clossys/advisor` and `@clossys/integrator` at their live registry versions in `devDependencies` of the existing `package.json`, bumping a frozen pin and adding a missing one, and rewrites the file only when a pin changes.
- The health report's `skillComposition.rosterTargets` lists the hub, the one checkout a run composes skills into, and each `skillComposition.preserved` entry describes a skill in the hub.
- `RepositoryObservation` has optional `pnpmWorkspaceText` and `npmrcText`, which `observeRepository()` fills with the exact text of the pnpm workspace file and of `.npmrc`, and the planner throws when either is not the file `files` digests. `observeRepository()` reports the `apply` phase only when the Starter pin is also in the range the setup templates support, so a repository pinned at `0.1.9` or `0.3.0` reads as `setup`, and a repository in its setup phase reports `.github`, `.starter` and, for pnpm, the workspace file it would create as roots its profile does not declare.
- `materializeRepository()` and `verifyRepository()` refuse, as `content-mismatch`, a release-age exemption file that is not the base commit's bytes plus one scope entry, as `verifyReleaseAgeExemption()` judges them over the base's `.npmrc`.
- `planApplyBundle()` skips a repository as `indeterminate`, outside the bundle digest, for a package manager other than npm or pnpm (`package-manager-unsupported`), a plan with no single Starter pin there (`starter-pin-absent`), a pin outside `STARTER_PIN_RANGE` (`starter-pin-unsupported`), a pnpm release-age file whose text is not supplied (`release-age-text-absent`) and a Starter request that cannot be rendered (`starter-request-invalid`), and it skips an apply set whose Starter pin would write a key (`starter-request-stale`).
- `planApplyBundle()` now computes a setup set for a repository in the setup phase: the four setup templates as `renderSetupTemplate()` renders them, the plan's Starter pin, every install the plan names deferred with the reason `after-setup`, and, for pnpm, one release-age exemption item whose edit comes from `editReleaseAgeExemption()`. A file the base already has is adopted only when its bytes are the set's own or a composed skill the skills manifest records, and is refused as `unowned-existing` otherwise.
- `renderStarterRequest()` refuses a Starter pin outside `>=0.2.0 <0.3.0` as `starter-pin-unsupported` and a Yarn repository as `package-manager-unsupported`.
- Launcher now exports pure renderers, including `renderSetupTemplate()`, that return the bytes of the Starter request, the adoption caller workflows, the CI workflow and the path-scope workflow that a setup change writes.
- A folder beside the hub that is not a git checkout, and a checkout git refuses to read for dubious ownership, each get their own `sibling` note instead of "git origin does not match inventory id".
- Resolving an inventoried repository beside the hub compares owners and the sibling checkout's git origin without regard to letter case, as GitHub does. An id whose owner differed from the hub's only in case was skipped as another account's, and an origin differing only in case was skipped as not matching (#1179).
- Each `sibling` line and `skillComposition.siblings` entry names its repository only by its position in the stored inventory (`repositories[<i>] in the stored inventory`), never by its id (#1179).
- The health report's degraded verdict and the run's result depend on the hub alone: an inventoried repository that is not cloned beside the hub, or whose checkout is dirty or carries output or pins an earlier release left, changes neither.
- The packed Launcher skill now has an "Apply an approved plan" section that tells the agent how to put a stored change set into a staffed repository: verify, file the task-record issue, open the pull request with the `launcher-apply-plan body` output, read `launcher-apply-plan status`, and report, without merging or pushing to the default branch (#1762).
- Launcher's packed skill catalogue carries Advisor's updated `SKILL.md`, which states an explicit degraded mode outside the hub -- a checkout only counts as the hub once its marker validates by `kind`, `schemaVersion` and a git-origin-matched `repository`, every write under `clossys/` is refused outside the hub (not only a decision), and the exact `npx --package=@clossys/advisor@<hub version> <bin>` invocation runs a bin without installing the package (#1507).
- Launcher's packed skill catalogue carries Advisor's updated `SKILL.md`, which leaves a hub-only role (Advisor or Integrator) in the mandate unstaffed and never staffs it in a repository (#1178).
- Launcher's packed skill catalogue carries Advisor's updated `SKILL.md`, which tells the agent to look a Launcher inventory message's reported position up before relaying a repository name to the founder (#1179).
- Launcher's packed skill catalogue carries Advisor's updated `SKILL.md`, which resolves a plan's exact packages with `advisor-package-request`, a registry snapshot and `advisor-resolve-packages` instead of saying that step is still to come (#1178).
- Launcher's packed skill catalogue carries Advisor's updated `SKILL.md`, which tells the agent that a `--replace-inventory` success line's removed position is labeled distinctly from the refusal it already saw, so it does not need a second lookup (#1179).
- Launcher's packed skill catalogue carries Advisor's updated `SKILL.md`, which says how to choose the hub's repositories on the repository card and record them with `launcher --repositories` (#1179).
- Launcher's packed skill catalogue carries Advisor's updated `SKILL.md`, which says what to do for each `advisor-resolve-packages` outcome by rule and when to skip package resolution (#1178).
- Launcher's packed skill catalogue carries Advisor's updated `SKILL.md`, which takes the registry snapshot with `launcher-apply-plan snapshot --request <file>` on a request saved to a temporary file, and stops resolving on exit `2` (#1178).
- Launcher's packed skill catalogue carries Advisor's updated `SKILL.md`, which names a package whose registry read failed by looking up the message's `names[<n>]` position in the request file (#1178).
- Launcher's packed skill catalogue carries Advisor's updated `SKILL.md`, which records `kits` and `staffing` in the plan, binds an approval through `subjectDigest`, and changes no digest-covered plan field from approval until apply completes (#1178).
- Launcher's packed skill catalogue carries Advisor's updated `SKILL.md`, which says to add no field the plan contract does not declare and that `recommendedNext.due` is optional and may be a plain date (#1475).
- Launcher's packed skill catalogue carries Strategist's updated `SKILL.md` (issue #1173), which says to read `clossys/brief.json`'s engagement context before interviewing for `audiences.json`; when the audience is not yet known, to send the founder to Advisor's own `audience` context card rather than asking a Strategist copy of its question; to always ask the audience's specific name, situation, and pains; and to never overwrite an audience already recorded in `audiences.json` with a brief-seeded guess.
- Before rewriting or retiring a composed skill, Launcher compares its `SKILL.md` with the digest recorded in `clossys/.state/skills.json`, and leaves a file whose content no longer matches that digest as it is instead of overwriting or deleting it (#1473).
- The `clossys-launcher` skill says to tell the founder which engine pins a run changed, and that the hub's package manager install and a commit of `package.json` with its lockfile come next.
- Launcher takes over an existing composed skill file that has no recorded digest only when its content already equals what Launcher would write; otherwise it leaves the file as it is (#1473).
- The health report lists each composed skill Launcher left as it is in the hub as a `skill preserved` line and under `skillComposition.preserved` in the report JSON, and marks the report degraded (#1473).
- The `clossys-launcher` skill says the hub's repositories are chosen on Advisor's repository card and written with `launcher --repositories`, and that `--replace-inventory` is used only after the client approves replacing a different inventory (#1179).
- Inventory documents are now validated against one shared contract, `docs/contracts/repository-inventory.json` (v1): `schemaVersion: 1`, a `repositories` array of `{ id, packages? }` entries, no other top-level or per-entry field. `id` must be a bare repository name or `owner/name` in the same format Launcher's own sibling/clone resolution already requires (no `.`, `..`, empty segment, whitespace, or more than one `/`), and two ids naming the same repository under a different letter case are a duplicate. `packages`, when present, must match `@clossys/integrator`'s `InventoryPackageEntry` (#996) exactly.

`--inventory <path>` is validated against that contract before it is written; a mismatch refuses before any file is touched, naming the offending field, and writes nothing (#1334).

Every read of the hub's stored inventory -- not only on appoint, but on every resume, including the sibling roster in the health report, and `--clone-missing` -- is validated the same way. Before this change, only a document that failed to parse as JSON at all was refused; a document that parsed but carried fields this contract does not recognize had its ids extracted and used anyway, with no warning that the document did not conform -- `--clone-missing` against such a document could `gh repo clone` a repository named only in that unrecognized-shaped entry. It now reports `invalid`, with the reason, in the health output, and `--clone-missing` clones nothing until the stored inventory is fixed.

An existing hub whose stored inventory carries fields beyond this contract's `id`/`packages` (for example a richer per-entry shape from before this contract existed) will now show as `invalid`, with the offending field named, instead of having its ids silently extracted and used with no warning.

The repository inventory contract also names two fields a future v2 does not add yet: a per-entry `status` and a GitHub repository id distinct from the human-chosen `id` string, planned alongside the apply-plan work (#1178).
- `validateAdvisorPlan()` and `validateEngagementBrief()` validate against the same shared contracts Advisor uses and refuse any field those contracts do not declare (#1475).
- New `validateRepositoryChangeSet()` and `validateApplyBundle()` validate a change set and a bundle against the shared change-set and bundle contracts, which this package now packs, including their code rules, refusing unknown fields and naming positions without echoing values (#1178).
- New `wouldViolateRootEntries()` judges whether the root names some paths introduce would fail a Controller repository profile's root vocabulary, naming the undeclared and the prohibited names, and is indeterminate when the profile's root vocabulary is unreadable (including one of more than 10,000 entries); it judges the root vocabulary only, not the rest of the profile; new `isRootEntryName()` is Controller's rule for one direct-child name (#1178).
- Each package skill's section for when the package is not installed speaks of the repositories the team is set up in, instead of every inventoried repository.
- Each package skill says the whole team is composed in the hub and a repository staffed in an approved plan gets `@clossys-advisor` and the voices of the roles staffed there once that plan's setup pull request has merged, so a missing `@clossys-<package>` mention is a bug only in the hub.

## 0.3.1 - 2026-09-24

- The packed conversation contract now names the five loop stages (`sense`,
`judge`, `act`, `verify`, `learn`) and the `loop` invocation keyword,
matching Controller's role-loop archetypes contract (#1194).
- The changelog is no longer included in the package; it now lives in the public repository, linked from the README.
- Remove the duplicated "How we work together" and "One question at a time"
sections from this package's packed skill (`skill/SKILL.md`).
`@clossys/launcher` injects the shared conversation contract when it
composes a skill for a consumer, so the packed skill no longer carries its
own byte-identical copy (#1182).
- The packed conversation contract now says where a skill's "Where we are"
comes from: the role's status probe summary, and never a hand-written
status file or any other file. If a role has no status probe, or the probe
cannot measure yet, the skill says so plainly.
- Fix the remaining #1205 inconsistencies: Designer's and Writer's packed
skills now say they supply the tokens, atoms, blocks, and copy ids a
surface document cites by reference rather than co-authoring it, matching
Publisher's skill. Publisher's surface-ownership module no longer says the
shared consumer layout contract (#1171) has not landed; that contract now
names Publisher as the owner of `clossys/publisher/surfaces`. Launcher's
packed skill catalogue carries a copy of each role's skill, so it is
released alongside the skill edits (#1184).

## [0.3.0] - 2026-09-22

### Added

- The product repository standard (#1215), recorded in this repository's own docs/contracts/product-repository-layout.json (not shipped in the published package) -- `apps/*`, workspace wiring, agent pointers, and CI, extending the consumer layout. `checkCloudSessionBootstrap()` verifies the three checks a cloud agent session (browser plus GitHub only, no local setup) needs before it can install and run the team in a product repository.
- `launcher-doctor`: a read-only command that checks git, the GitHub command-line tool, sign-in, Node.js, and npm, and names the first missing prerequisite in plain language with the one next action to take -- never a dump of everything at once (#1220).
- Adopts an existing repository inventory instead of writing a second, diverging one, when the hub marker declares an `externalInventory`. `reportInventoryDrift()` runs automatically on every `launcher` create, resume, or appoint and prints the result in hub health output -- external-only, launcher-only, and agreeing repository ids, all three even when one is empty -- instead of silently merging them (#1216).
- `--clone-missing`, an explicit, non-default flag on `launcher` that clones inventoried repositories not yet sitting beside the hub (#1179), reversing the previous no-clone default for exactly this one approved action. Plain invocation is unchanged: still report-only by default.
- Every `launcher` create, resume, or appoint records which coding-agent hosts a directory could already discover skills through -- read before that same run composes skills and stamps every host's discovery path -- into `clossys/.state/hosts.json`, for the hub and every sibling clone (#1180). Codex is detected by the presence of `.agents/skills` itself -- verified against Codex's own documentation, which reads repository skills from that path directly and needs no separate discovery symlink the way Claude Code and Cursor do.
- Ships a per-host model profile (`model-profiles/<host>.json`) mapping the fixed reasoning tiers (`light` / `standard` / `deep`) to that host's current models, and reads `clossys/preferences.json`'s budget stance to resolve within it (#1219). Packages never name a model; only this profile does.
- `launcher-apply-plan`: validates an approved `clossys/advisor/plan.json` and an `EngagementBrief`-shaped `clossys/brief.json` against the "Plan file contract" recorded on issue #1175, then writes the brief into a staffed repository byte-identically (#1178, #1176). Multi-repository orchestration (branch creation, exact package installs, Starter's caller workflow, opening one pull request per repository) is deferred -- see the package README's "Applying an approved plan" section for why.

### Changed

- `README.md`: documents the new commands and exports, and updates the "does not clone" line to describe the new explicit `--clone-missing` exception.

### Fixed

- `detectLinkedHosts()` (#1180) and `reportInventoryDrift()` (#1216) are now called from the real `launcher` command path (`applyWorkspacePlan`, via `composeSkillRoster` / `finishHubApply`) on every create, resume, and appoint, instead of existing only as library functions nothing called. Per independent review at f2a50de707f8682c6885592f2910425c2e5a0b5f: neither had a reachable call site, so no client-run command actually recorded a linked host or reported inventory drift despite the PR body and this changelog describing both as delivered behavior.

## [0.2.0] - 2026-09-22

### Added

- Scaffolds one visible `clossys/` folder per repository: a generated `README.md` index of active roles at the root of `clossys/`, and `clossys/.state/` for machine files (hub marker, inventory, and the new skills manifest).
- Writes `clossys/.state/skills.json` on every apply: each composed skill's source (`installed` or `catalogue`), version, and a content digest. The health report states how many composed skills are out of date against the live `@clossys/launcher` version and how many were retired this run; retirement removes only a skill this directory's own previous manifest listed, never one launcher did not write.
- Packs the shared conversation contract at build time and injects it into every composed skill in place of that skill's own "how we work together" and "one question at a time" sections, at the same position. No package edit is needed for this to take effect.

### Changed

- Moves its own hub marker and inventory from the hidden `.clossys/` to the visible `clossys/.state/`; the packed skeleton template moves with it. Resume detects a hub still on the legacy path and migrates it automatically, reporting the move in the health report. A hub with a marker at both paths is graded `indeterminate` and launcher refuses rather than merging them silently.
- Adds a `.gitignore` entry for generated run output under `clossys/**/.generated/`. Approved records, proof, and machine state are still committed, never ignored.

## [0.1.8] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

### Fixed

- Skill compose prefers each checkout's installed `@clossys/<package>/skill/SKILL.md` when present, then falls back to the packed catalogue or sibling source.
- Apply marks hub health degraded when the skill roster skips inventoried targets; missing per-package catalogue sources remain notes only.

## [0.1.7] - 2026-09-20

### Changed

- Packed skill catalogue now carries pre-auth fold gates, the exceptional-keep brief that ships with `@clossys/designer` (synthetic user, not the doer, the sealer, or a QA contractor), and expression-wave skills that treat 3 as the floor not done.

## [0.1.6] - 2026-09-20

### Changed

- Appoint now pins live `@clossys/advisor` in `devDependencies` only. It relocates a pin left in another bucket and overwrites a frozen version. A dedicated `{owner}/workspace` hub is named `@owner/workspace`; an appointed product keeps its package name.
- Observe always reads the public Advisor version, including when a pin already exists, so appoint can write the live pin and resume can grade it.
- Health is degraded when Advisor is missing, dual-pinned, or present outside `devDependencies`, not only when the pin is older than live.
- New-hub skeleton package name is `@owner/workspace`.
- New-hub `AGENTS.md` tells the coding agent to speak to a founder in
  ordinary sentences: where we are, what to do next, what we will not
  do, and whether anything is saved to git. Machine identifiers stay
  out of the default voice.

### Fixed

- Resume health now receives the live Advisor version from observe, so a stale or misplaced pin is visible on every resume instead of only after a fresh appoint.

## [0.1.5] - 2026-09-20

### Fixed

- Discovery compose skips a `.claude/skills` or `.cursor/skills` path that is already a symlink so it cannot replace composed `SKILL.md`.

## [0.1.4] - 2026-09-19

### Added

- Hub apply composes the full `clossys-*` skill tree under `.agents/skills/` on create, appoint, and resume, reading bodies from the packed skill catalogue (built at `npm run build` from each package's skill source) or from a sibling checkout. Missing sources are skipped with a health note; apply continues.
- The same roster is composed into every inventoried repository clone beside the hub (resolved from the generated hub inventory and confirmed with `git remote get-url origin`); the health report lists targets and skipped ids. Sister checkouts get optional canned `AGENTS.md` only when missing or still the generated sister text.
- Apply writes host discovery links under `.cursor/skills/` and `.claude/skills/` pointing at the composed skills in the hub and each resolved clone.
- Packed Agent Skill `clossys-launcher` so a coding agent can be invoked as `@clossys-launcher`.

### Changed

- Resume refreshes composed skills and replaces stale generated `AGENTS.md` when it still tells founders to use `npx` to continue the conversation; customized `AGENTS.md` files are left alone.
- Founder-facing hub guidance (`CONSUMER_AGENTS_MD`, skeleton README) now states the same `@clossys-*` team is available in every inventoried checkout; `@clossys-advisor` is the hiring check; `npx @clossys/launcher` refreshes voices on clones beside the hub.

## [0.1.2] - 2026-09-19

### Fixed

- Appoint merges `--inventory` into a populated on-disk hub inventory instead of silently discarding the supplied document: repositories are unioned by id (on-disk order first, new ids appended in supplied order, first occurrence of an id wins) and the merged document is written to `.clossys/inventory.json` (that on-disk path does not ship with this package). The both-empty refusal is unchanged.
- Resume with `--inventory` now refuses with "hub already appointed; edit `.clossys/inventory.json`" (that on-disk path does not ship with this package) instead of the misleading "--inventory is only valid when appointing".
- Appoint refuses as `violated` when `CLOSSYS_OWNER` names a different account than the repository's github.com origin owner, naming both values; the marker is no longer written for the wrong account.
- Appoint no longer requires a readable npm registry when the tree already pins `@clossys/advisor` in any dependency bucket (no new version would be needed); the indeterminate refusal only fires when a version is actually required.
- Appoint refuses as `violated` when `git status --porcelain` is non-empty, before writing anything; when the origin is not on github.com the refusal names the remote host.

### Added

- Health report grades each Advisor pin against the live registry version (internal semver compare, no new dependencies): pin older than live is a `stale pin` finding and marks the report degraded; equal pins pass; unparseable comparisons are noted as indeterminate. Exit stays 0 on resume; adopt prints the same report.
- Pin and extra-`@clossys/*` scans now cover `optionalDependencies` and `peerDependencies` in addition to `dependencies` and `devDependencies`.
- `checkInventoryEntries()`: read-only validation of hub inventory repository ids through batched `gh repo view --json name`, marking unknown ids in the report and skipping with a note when `gh` is absent. Never mutates the inventory.
- `launcher-check` forwards `cwd.hub`, so a captured existing-hub observation grades as resume instead of mis-grading as adopt.

## [0.1.1] - 2026-09-19

### Fixed

- Appoint leaves an existing `@clossys/advisor` pin in whichever bucket it already occupies. It no longer dual-pins or overwrites a frozen version with the live registry version.
- Appoint refuses when the generated hub inventory is missing or empty (packed template `skeleton/.clossys/inventory.json`; that generated path does not ship), unless `--inventory <path>` supplies a populated document. Create may still write an empty inventory. Resume does not invent one.

### Added

- Read-only health report after create, resume, and appoint: hub marker, inventory classification, Advisor pin location and version versus live, dual pin, extra `@clossys/*` names. Does not uninstall.

## [0.1.0] - 2026-09-18

### Added

- `npx @clossys/launcher` as the single get-started command.
- In-package hub skeleton (not a Foundry fork) copied into a GitHub repository.
- Create a new `{owner}/workspace` hub, resume an existing hub, or adopt the current GitHub repository as the account hub.
- Owner inference from `gh` and git remotes, with an interactive picker only when more than one GitHub owner is visible.
- `launcher-check --input` grades a captured observation without creating a hub, so qualification can prove the 0/1/2 ternary.
