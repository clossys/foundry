# Foundry Launcher

Foundry Launcher (`@clossys/launcher`) is executable tooling
that makes one GitHub repository the account workspace hub. It is not a role
and does not claim adoption, grounding, or closure.

The hub inventories where Foundry packages are installed and coordinates
engagement. It is not a product application and does not receive a dump of
the catalogue.

## Layout: the `clossys/` folder

Every apply writes to one visible `clossys/` folder in the target repository —
never a hidden dot-folder for anything a person might want to see. A generated
`README.md` at the root of `clossys/` is an index of which `clossys/<role>/` folders are active and what
each holds; it is rewritten on every run, never hand-edited. `clossys/.state/`
holds machine files only — the hub marker, the inventory, and the skills
manifest (below) — visible so it is easy to find, but still not a place to
edit by hand. Other roles' folders (`clossys/strategist/`, `clossys/writer/`,
and so on) are written by their own packages, not by launcher.

A hub created before this layout existed kept its marker and inventory under
a hidden `.clossys/`. Resume detects that automatically and migrates both
files to `clossys/.state/`, removing the old directory, and reports the move
in the health report. If somehow both a `.clossys/` and a `clossys/.state/`
hub state exist at once, launcher refuses rather than guessing which one is
current — remove one and resume again.

## Conversation contract

Every composed skill carries one shared conversation contract: lead with a
plain-language status, always state a recommendation, ask exactly one
question with the recommended option labelled first, and say what happens
next. Launcher packs this contract at build time and injects it into each
composed skill in place of that skill's own "how we work together" and "one
question at a time" sections, at the same position — so an installed or
catalogue skill's own wording never has to drift from it.

## Skills manifest and freshness

Every apply writes a skills manifest recording each composed skill's source
(`installed` or `catalogue`), version, and a content digest. The health
report states how many composed skills are out of date against the live
`@clossys/launcher` version (catalogue-sourced skills are only ever as fresh
as the launcher release that packed them) and how many were retired this
run. Retirement means: a skill this directory's own manifest previously
listed is no longer composed (its source disappeared), so launcher removes
its composed output and host discovery links — and only that. It never
touches a skill it did not itself write.

The recorded digest is how launcher tells whether it still owns a composed
skill. Before rewriting or retiring one, it compares the file on disk
(`.agents/skills/clossys-<package>/SKILL.md`, and any real-directory copy
at a host discovery path) with the digest it recorded when it last wrote
that file:

| On disk | Rewrite (skill still composed) | Retire (skill no longer composed) |
| --- | --- | --- |
| Matches the recorded digest | Rewritten | Removed, with its discovery links |
| Edited since launcher wrote it | Left as is and reported | Left as is, with its discovery links, and reported |
| Missing | Recreated | Retirement completes (discovery links removed) |
| No recorded digest (first run, or an older install) | Adopted if it already equals what launcher would write; otherwise left as is and reported | Not touched: launcher only retires a skill its manifest records |

A `SKILL.md` that exists but cannot be read (a permissions error, or a
directory in its place) is treated like an edited one: left as is and
reported. A retiring skill directory that holds files other than `SKILL.md`
is also left as is and reported; a macOS `.DS_Store` file is ignored for
this check. Each skill left as is appears in the health report as a
`skill preserved` line naming the file or directory that failed the check,
and in the report JSON under
`skillComposition.preserved`; it marks the report degraded, and it is
reported again on every run until resolved. Launcher recreates a missing
composed skill because `.agents/skills` is launcher-generated output, so
recreating it loses nothing a client wrote. That is also how to take
launcher's version of a skill you edited: move your copy aside, delete the
directory the `skill preserved` line names (usually
`.agents/skills/clossys-<package>/`), and run launcher again. To keep your
edit instead, leave the file as it is.

## Health report and staleness

After create, resume, or appoint — and on every resume — the command prints
a read-only health report. It scans all four dependency buckets
(`dependencies`, `devDependencies`, `optionalDependencies`,
`peerDependencies`) for the Advisor pin and for extra `@clossys/*` names.
When the live registry version is known, each pin is graded against it: a
pin older than live is a `stale pin` finding and marks the report
**degraded**. The report is also degraded when Advisor is missing, dual-pinned,
or present in any bucket other than `devDependencies`, and when apply skipped
one or more inventoried roster targets (missing sibling clone, origin mismatch,
and similar — the same `skill roster skipped` lines in the report), and when
a composed skill was left as is because a client edited it (the
`skill preserved` lines above, for the hub and every sibling clone). Per-package
skill sources missing from the catalogue are noted but do not by themselves mark
degraded. Exit stays 0 on resume
(the report is advisory); adopt prints the same report and an unparseable
pin-versus-live comparison is noted as indeterminate rather than stale.
`checkInventoryEntries()` additionally validates hub inventory ids read-only,
marking ids whose repository no longer resolves (skipped with a note when
`gh` is unavailable).


## Install

The get-started command is the package name:

```bash
npx @clossys/launcher
```

`npx` caches the resolved version, so a plain `npx @clossys/launcher` can
keep running an old one. Because a catalogue-sourced skill is only ever as
fresh as the launcher release that packed it (see "Skills manifest and
freshness" above), run:

```bash
npx @clossys/launcher@latest
```

when the health report says a skill is out of date, or whenever you want to
be sure you are on the current release.

Public npm reads are credentialless. Packages publish to
`https://registry.npmjs.org`. Do not add a token or private registry
mapping for `@clossys`. Pin an exact version once you depend on the library
API:

```bash
npm install --save-dev --save-exact @clossys/launcher@0.2.0
```

## Talking to the team

First contact is `npx @clossys/launcher` (empty directory or the checkout you
appoint as the hub). After apply, the launcher composes the same
`@clossys-<package>` voices into the hub and into every inventoried repository
checkout that already sits beside the hub (`.agents/skills/clossys-<package>/`
plus host discovery links). Composition is per checkout, not machine-wide, and
is not a catalogue dump into `package.json`.

Voices are how you talk in a coding agent; they are not engagement engines. The
`@clossys/advisor` npm package is the engine that grades evidence;
`@clossys-advisor` in chat is its hiring and compatibility voice. Use
`@clossys-advisor` and `@clossys-<package>` in the hub or in any inventoried
product repository. Each voice can talk even when that npm package is not pinned
in that repo. When composing into a checkout, the launcher reads each skill body
from that checkout's installed `@clossys/<package>/skill/SKILL.md` when present,
then from the packed catalogue or a sibling monorepo source. Launcher health
notes missing catalogue sources but apply continues.

Run `npx @clossys/launcher` again from the hub for a health report and to
refresh composed voices on sibling inventoried clones. By default it does
not `gh repo clone` missing inventory entries -- that is not how you talk to
the team. `launcher --clone-missing` is the one explicit, approved
exception (#1179): on resume only, it clones every inventoried repository
not yet sitting beside the hub, using `cloneMissingInventoryRepositories()`,
and only those -- an id skipped for any other reason (wrong account, the
Foundry supplier tree, a mismatched git origin) is left exactly as skipped,
never attempted.

## How to run it

There is no `--org` flag. Owner is inferred from authenticated `gh` and from
the current git remote. If more than one GitHub owner is visible, the
command asks which one should hold the hub. Non-interactive runs may set
`CLOSSYS_OWNER`.

GitHub-only. A GitLab, self-hosted, or other remote is a refusal, not a
silent fallback.

| Current directory | What happens |
| --- | --- |
| Empty | Creates `{owner}/workspace` from the in-package skeleton (package name `@owner/workspace`), or clones that hub if it already exists. |
| Already a hub (generated marker; packed template `skeleton/clossys/.state/workspace.json`) | Resumes. No new repository. `--repositories` writes the repositories the founder chose again into `clossys/.state/inventory.json` before skills are composed (see "Choosing the hub's repositories" below). `--inventory` here is refused, and the refusal points at choosing the repositories again on Advisor's repository card and running `launcher --repositories`, instead of at hand-editing the file. A legacy `.clossys/` hub state is migrated automatically; see "Layout" above. |
| Any other GitHub repository you control | Appoints it as the account hub. Keeps existing product files. Refuses when the working tree has uncommitted changes (`git status --porcelain` non-empty) — the refusal names the offending remote host when the origin is not on github.com. Refuses when `CLOSSYS_OWNER` names a different account than the repository's github.com origin owner. Writes the hub marker. Pins live `@clossys/advisor` in `devDependencies`, relocating and upgrading any pin left in another bucket. A dedicated `{owner}/workspace` checkout is named `@owner/workspace`; a product repository keeps its package name. Always reads the public Advisor version (needed to pin live and to grade resume health). Refuses if the generated hub inventory is missing or empty (packed template `skeleton/clossys/.state/inventory.json`; that generated path does not ship), and the refusal points the founder at choosing the hub's repositories on Advisor's repository card and passing them to `--repositories`, which writes the inventory (see "Choosing the hub's repositories" below). `--inventory <path>` still supplies a populated document instead — and, when the on-disk inventory is already populated and `--inventory` is also supplied, merges the two by repository identity (on-disk order first, new repositories appended, the first occurrence of a repository kept, and every kept entry kept whole, its `packages` included). Does not rewrite the lockfile or dump the catalogue. Prints a read-only health report. |

It does not have to be a brand-new exclusive repository, and it does not
have to already match a Foundry layout. Informal "workspace-looking" trees
are appointed by writing the hub contract, not assumed to be hubs already.
Product applications may be appointed: they become the hub **and** remain
the product. Sister repositories still pin their own roles. Appoint does
not install packages.

Do not run this inside the Foundry supplier tree.

Open the resulting folder in your coding agent. Talk in ordinary
sentences. Advisor stays read-only until you approve a next action. A
yes in chat is permission for that one step only; it is not a lasting
grant and it does not write git unless a file is saved later. The same
command resumes later.

## Choosing the hub's repositories

A founder never writes the inventory by hand (#1179). Advisor's repository
card (`@clossys/advisor`'s `repositoryChoiceCard()`, or its
`advisor-repository-card` bin before the hub exists) offers the
repositories the agent listed from GitHub for the founder's sign-in; the
founder chooses; and the agent passes the chosen ids to Launcher:

```bash
launcher --repositories example-owner/example-app,example-owner/example-site
```

`--repositories` takes one argument of comma-separated repository ids (an
id never contains a comma). It works when appointing a repository as the
hub and on an existing hub checkout; in an empty directory it is refused,
because there is no hub to write into yet. Launcher writes the chosen ids to
`clossys/.state/inventory.json` (a generated hub path, not shipped in this package)
-- the one inventory location it reads on
every later run -- and, on resume, writes it before composing skills, so the
same run composes into the repositories just chosen.

- The ids, and the document built from them, are checked against
  `docs/contracts/repository-inventory.json` (in the public repository;
  that exact path does not ship in this package, but this package's build
  packs and ships its own copy of the contract) through the same shared
  contract checker every read of the inventory uses, and the document is
  checked again by that reader before it is written. What Launcher writes is
  what Launcher reads back.
- A malformed choice -- an empty id, an id that is not a bare name or
  `owner/name`, or two ids naming the same repository -- is refused by
  position (`repositories[1].id ...`), never echoed, and nothing is written.
- Launcher decides "is this the same repository" one way everywhere: a
  bare id names a repository of the hub's own owner, and letter case is
  ignored, so `app`, `App` and `<owner>/app` are one repository. Owners are
  compared the same way. A stored inventory, or a choice, that lists one
  repository twice this way is refused, naming the two positions; it is
  never merged. The hub itself is recognised by its origin's `owner/name`
  (or, without a github.com origin, the repository its marker records),
  never by its folder path, so an inventory that names the hub in another
  letter case never composes it a second time as its own sibling.
- An inventory that already lists exactly the chosen repositories, in any
  order or letter case, or with a bare id for the hub's own owner, is left
  as it is.
- An inventory that lists a different set is never merged into or
  overwritten silently: the run is refused, stating how many repositories
  each side has and which ids would be added and removed. Run again with
  `--replace-inventory` to approve the replacement; a repository that stays
  keeps its existing entry, `packages` included.
- An inventory that fails its contract is likewise replaced only with
  `--replace-inventory`.
- `--repositories` and `--inventory` each supply the whole inventory, so
  they are refused together, and `--replace-inventory` without
  `--repositories` is refused.

## CLI

```bash
launcher
launcher --repositories example-owner/example-app,example-owner/example-site
launcher --repositories example-owner/example-app --replace-inventory
launcher --inventory path/to/inventory.json
launcher --clone-missing
launcher --help
launcher-check --help
launcher-check --input observation.json
launcher-doctor
launcher-apply-plan --plan plan.json --brief brief.json --repo ./product-checkout
launcher-apply-plan snapshot --request package-request.json
```

Exit codes preserve the ternary:

| Exit | State | Meaning |
| --- | --- | --- |
| `0` | `satisfied` | Created, resumed, or appointed the hub. The message includes a read-only health report. |
| `1` | `violated` | Known refusal: not GitHub, not empty, missing appoint inventory, a malformed `--repositories` choice or one that differs from the stored inventory without `--replace-inventory`, the supplier tree, uncommitted changes in the appoint tree, or a `CLOSSYS_OWNER` that disagrees with the origin owner. |
| `2` | `indeterminate` | Missing `gh`, unreadable registry pin, or an owner that could not be inferred. |

`launcher-apply-plan` has its own exit codes, described in [Applying an approved plan](#applying-an-approved-plan) and [Taking the registry snapshot](#taking-the-registry-snapshot).

`launcher-check` grades a captured observation JSON through `planWorkspace` and does not create a hub. Same ternary: 0 is a create/resume/adopt plan, 1 is a known refusal, 2 could not run or could not decide. Appoint grades as a plan only when the observation already records a populated inventory; `--inventory` is a live CLI flag, not a check-cli input.

## API

| Export | Description |
| --- | --- |
| `planWorkspace()` | Decides create, resume, or adopt from a cwd observation. Optional `PlanWorkspaceOptions`: `{ repositories, replaceInventory }` (`--repositories` / `--replace-inventory`; appoint or resume) or `{ inventoryPath }` (`--inventory`; appoint only) are the ways to appoint without a populated on-disk inventory. A plan carrying `repositories` holds the resulting `ChosenInventory`: the exact document to write, or `unchanged`. An appoint plan that merges `--inventory` into a populated stored inventory carries `mergedInventoryRepositories`, the merged entries, each kept whole, and `mergedInventoryDocument`, the exact merged document those entries render to, which apply writes. |
| `applyWorkspacePlan()` | Copies the in-package skeleton or hub marker through a host port and returns a `WorkspaceApplyResult` with health. Composes the same skill voices (with the shared conversation contract injected) on the hub and on inventoried sibling checkouts beside it; refreshes stale hub guidance and the generated `clossys/` README on every path, including resume; migrates a legacy `.clossys/` hub state automatically. Optional `{ skillCatalogueRoot, launcherPackageRoot, contractPath, liveLauncherVersion }` selects where skill and contract bodies are read and grades skill-manifest staleness. |
| `observeWorkspace()` | Reads `gh`, git remotes, cwd, inventory classification, hub-state migration status, and the public Advisor version. |
| `readInventoryRepositories()` | Reads repository ids from an inventory file, as bytes, routed through `validateInventoryDocument()` (a missing file reads as no ids; anything present but invalid throws, naming the offending field by position -- never silently accepted or silently emptied). An optional fourth argument, the hub's owner, makes a bare id and `<owner>/<id>` one repository. |
| `readLiveLauncherVersion()` | Reads the public `@clossys/launcher` registry version, used only to grade catalogue-sourced skill staleness. |
| `launcherPackageRootFromModule()` | Resolves this package's root from `import.meta.url` so apply can find the packed skill catalogue and contract. |
| `parseGitHubRemote()` | Parses a github.com remote and rejects any other host. |
| `isHubDocument()` | Type guard for the generated hub marker (packed template: `skeleton/clossys/.state/workspace.json`). |
| `inspectInventory()` | Classifies an inventory document -- pass the file's bytes, and the hub's owner when known -- as missing, empty, populated, or invalid (malformed or schema-mismatched -- never silently folded into empty; see `validateInventoryDocument()`). |
| `validateInventoryDocument()` | Strictly validates an inventory document -- a file's exact bytes, or text built in memory -- against `docs/contracts/repository-inventory.json` (in the public repository; that exact path does not ship in this package, but this package's build packs and ships its own copy of the contract; `schemaVersion: 1`, a `repositories` array of `{ id, packages? }` entries -- `id` a bare repository name or `owner/name` in the same format Launcher's own sibling/clone resolution requires, case-insensitively unique; `packages`, when present, shaped exactly as `@clossys/integrator`'s `InventoryPackageEntry`, no other key). It is read as strict JSON (a syntax error is reported by position only; a key repeated in any object, bytes that are not valid UTF-8, a leading byte order mark, or a lone surrogate, escaped or raw, is refused) and checked by the same shared contract checker, packed from `@clossys/advisor`, that checks the plan and the brief. With `InventoryReadOptions` `{ hubOwner }`, a bare id and `<hubOwner>/<id>` are also one repository, and a document listing both is refused. Returns `{ valid: true, ids }` or `{ valid: false, reason }`, where `reason` names every field at fault by position and never quotes a value. Every read and write of an inventory document -- `--inventory`, `--repositories`, the on-disk `clossys/.state/inventory.json` (a hub path, not shipped in this package) on every run, and `readInventoryRepositories()` -- passes the file's exact bytes, read with `WorkspaceHost.readBytes()`, never text decoded first, so invalid bytes cannot be silently replaced before the check; an inventory Launcher copies (`--inventory`, or a legacy `.clossys/` inventory it migrates) is written back byte for byte; a document that merely resembles an inventory (for example a governance record whose entries also carry `role`, `visibility`, `status`, `notes`) is refused, never adopted or silently read as though it validated (#1334). |
| `reportHubHealth()` | Read-only pin, inventory, migration, and skills-manifest report. Does not install or uninstall. |
| `formatHubHealth()` | Human lines plus a `health:` JSON line for the same report. |
| `hasAdvisorPin()` | True when a manifest already pins Advisor in any dependency bucket. |
| `checkInventoryEntries()` | Read-only inventory id validation through `gh repo view` (batched; skips with a note when `gh` is unavailable). |
| `DEFAULT_REPOSITORY_NAME` | Default new-hub repository name (`workspace`). Used only when creating, never when appointing. |
| `CLOSSYS_DIR_REL` | Relative path of the one visible per-repository Clossys folder (`clossys`). |
| `STATE_DIR_REL` | Relative path of the machine-state folder (`clossys/.state`). |
| `WORKSPACE_MARKER_REL` | Relative path of the hub marker. |
| `WORKSPACE_INVENTORY_REL` | Relative path of the hub inventory. |
| `CLOSSYS_README_REL` | Relative path of the generated index README at the root of `clossys/`. |
| `LEGACY_STATE_DIR_REL` / `LEGACY_WORKSPACE_MARKER_REL` / `LEGACY_WORKSPACE_INVENTORY_REL` | Pre-#1171 `.clossys/` paths, kept only so resume can detect and migrate them. |
| `CommandResult` / `ChosenInventory` / `CwdObservation` / `DependencyBucket` / `HubDocument` / `HubHealthReport` / `HubMigrationState` / `InventoryObservation` / `InventoryValidationEntry` / `InventoryValidationReport` / `InventoryReadOptions` / `PinFinding` / `PinGrade` / `PlanWorkspaceOptions` / `SkillManifestDocument` / `SkillManifestEntry` / `SkillsManifestSummary` / `ApplyWorkspaceOptions` / `WorkspaceApplyResult` / `WorkspaceDecision` / `WorkspaceHost` / `WorkspaceObservation` / `WorkspacePlan` / `WorkspaceRefusal` / `WorkspaceState` | Typed host, observation, plan, health, and outcome contracts. A `WorkspaceHost` reads and writes text and, for inventory files, exact bytes (`readBytes()` / `writeBytes()`). |
| `cloneMissingInventoryRepositories()` | Explicit, approved action (#1179): clones every inventoried repository `resolveSisterCloneTargets` skipped for "not beside the hub", and only those. Returns a `CloneMissingOutcome[]`. |
| `runDoctorChecks()` | Read-only prerequisite checks in fix-in-this-order sequence: git, `gh`, signed in, Node.js, npm, then the advisory coding-agent step. Returns a `DoctorReport`. |
| `renderDoctorReport()` | Renders a `DoctorReport` one step at a time, the way `launcher-doctor` prints it. |
| `checkCloudSessionBootstrap()` | Read-only: the three product-repository-layout.json cloud-session-bootstrap checks against a directory. Returns a `CloudBootstrapReport`. |
| `reportInventoryDrift()` | Compares a declared external inventory against the launcher-written one; reports external-only, launcher-only, and agreeing repository ids. Both files are read as bytes by the strict reader. An optional fifth argument, the hub's owner, compares ids as every other Launcher comparison does (a bare id is that owner's; case is ignored). The hub's own inventory is read with `validateInventoryDocument()`: a missing one lists nothing, and one that is present but invalid makes the report `indeterminate`, never a comparison against an empty list. Returns an `InventoryDriftReport`. |
| `detectLinkedHosts()` | Read-only: which of `claude-code`, `cursor`, `codex` can currently discover skills in a directory. |
| `serializeHostRecord()` / `parseHostRecord()` | Round-trip `clossys/.state/hosts.json` (`HOSTS_REL`). |
| `parsePreferences()` | Reads `clossys/preferences.json`'s budget stance; defaults to `"balanced"` on absence or malformed input. |
| `readHostModelProfile()` | Reads a packed `model-profiles/<host>.json`; returns `undefined`, never throws, on a missing or malformed file. |
| `resolveModelForTier()` | Resolves a tier and budget preference to one model name for a host, reporting `belowFloor` rather than silently substituting a weaker tier's model. |
| `validateAdvisorPlan()` / `validateEngagementBrief()` | Validation of `clossys/advisor/plan.json` and `clossys/brief.json` (with its `context` snapshot) against the shared plan and brief contracts Advisor also validates against, including the contracts' code rules (R1-R11 for a plan, B1-B2 for a brief). Unknown fields are refused; the reason names every field at fault. |
| `approvedSubject()` | What an approval binds: the `subjectDigest` of the plan's latest decision (by timestamp) when that decision has `chosen === "approved"`, else `null`. `null` when the approval has no `subjectDigest`, when decisions at the latest time disagree or name different subjects, when any decision time does not parse, or when the plan does not validate. Anything that applies a plan must use this; the one stated exception is the legacy brief-only path (`applyEngagementBrief()` and `launcher-apply-plan`), which predates the binding and uses `isPlanApproved()`. |
| `isPlanApproved()` | True only when a plan's most recent decision (by timestamp) has `chosen === "approved"`. False when decisions at that latest time disagree, or when any decision time does not parse. It binds no bytes: it ignores `subjectDigest`, so it is also true for an approval that names no change. |
| `applyEngagementBrief()` | Writes `clossys/brief.json` into a repository directory once the plan validates and is approved and the brief validates; refuses and writes nothing otherwise. Reports the plan's canonical digest. |
| `planDigest()` / `canonicalJson()` / `canonicalDigest()` / `PLAN_DIGEST_EXCLUDED_FIELDS` | The canonical plan digest: `sha256:` over the RFC 8785 canonical JSON of the plan without `asOf` and `decisions`. Identical to Advisor's for every plan. `canonicalDigest()` is the shared step: `sha256:` over the canonical JSON of any value, which the plan, change-set and bundle digests all use. |
| `planApplyBundle()` | The pure apply planner: from a validated plan, the hub brief, observations of each staffed repository's default branch, the composed skill text, the producer version and the hub's Advisor pin, computes one change set per staffed repository and a report-mode bundle. Reads no file, network, process or clock; the same inputs give the same bytes. Throws, naming positions and never values, on inputs it cannot plan from. |
| `projectEngagementBrief()` / `serializeEngagementBrief()` / `PUBLIC_PROBLEM_PLACEHOLDER` | One repository's brief: the hub brief with `staffedHere` set to that repository's roles in plan order, and `problem` replaced by the brief contract's fixed placeholder unless the repository is private, members in the brief contract's order at every depth; and the exact bytes written for it (two-space JSON and a final newline). |
| `changeSetDigest()` / `changeSetDigestSubject()` / `CHANGE_SET_DIGEST_EXCLUDED_FIELDS` / `DERIVED_FILE_DIGEST_FIELDS` | The change-set digest: `canonicalDigest()` of the change set without `changeSetDigest`, `branch`, `bundle`, `pullRequest`, `inverse` and `tooling`, with each derived file reduced to `path`, `mode`, `derived`, `item` and `invariants`. |
| `bundleDigest()` | The bundle digest an approval binds: `canonicalDigest()` of the plan digest and, sorted by id, the id and change-set digest of each repository that has a change set. Nothing else. |
| `validateRepositoryChangeSet()` / `validateApplyBundle()` | Validation of a change set and a bundle against the shared change-set and bundle contracts, including their code rules (C1-C10 for a change set: references, allow-list and case-insensitive path rules, the ledger, the digest, only the ledger and lockfile derived, canonical order, each computed item's writes matching it, a pin-starter in devDependencies and at most once, and phase; A1-A4 for a bundle: unique ids, the digest, verdicts that are the worst of their checks, and the authorization-mismatch and authorization-absent checks). Unknown fields are refused; no reason echoes a value. |
| `CloneMissingOutcome` / `DoctorCheckHost` / `DoctorReport` / `DoctorStepId` / `DoctorStepResult` / `CloudBootstrapCheck` / `CloudBootstrapReport` / `ExternalInventoryDeclaration` / `InventoryDriftReport` / `DiscoveredHost` / `HostRecord` / `BudgetPreference` / `HostModelProfile` / `HostTierMapping` / `ModelResolution` / `PreferencesDocument` / `ReasoningTier` / `SupportedHost` / `AdvisorPlan` / `ApplyBriefResult` / `BlockerKind` / `EngagementBrief` / `EngagementBriefRole` / `EngagementContext` / `EngagementContextField` / `EngagementContextFieldId` / `GoalDirection` / `PlanBlocker` / `PlanDecision` / `PlanKit` / `PlanPackageAct` / `PlanStaffing` / `ValidationResult` / `PlanApplyBundleInputs` / `PlanApplyBundleResult` / `RepositoryObservation` / `SkippedRepositoryObservation` / `BundleDigestEntry` / `ApplyBundle` / `ApplyBundleRepository` / `ApplyCheck` / `ApplyCheckId` / `ChangeSetDeferral` / `ChangeSetItem` / `ChangeSetPhase` / `ChangeSetRefusal` / `CheckVerdict` / `ContentDigest` / `DependencyPlacement` / `DerivedFileChange` / `FileChange` / `KeyChange` / `LedgerInvariant` / `LockfileName` / `PackageInvariant` / `PackageManagerKind` / `PinnedPackage` / `RefusalReason` / `ReleaseAgeSurfaceKind` / `RepositoryChangeSet` / `RepositoryVisibility` / `WholeFileChange` | Typed contracts for the sections above. |

## Doctor

`launcher-doctor` (installed alongside `@clossys/launcher`) is read-only and
never writes anything (#1220). It checks the prerequisites a client needs
before the hub even exists -- git, the GitHub command-line tool, whether
you are signed in, Node.js, and npm -- and reports the first thing that is
missing, in plain language, with the one next action to take. Run it again
after fixing that one thing; it always reports the next thing, never a dump
of everything at once. A missing coding agent is reported but never blocks
the verdict: `runDoctorChecks()` marks it advisory, since Launcher cannot
detect every host and it is a one-time choice, not a step to fix in
sequence. `renderDoctorReport()` renders the report the way the CLI prints
it.

## Product repositories

`docs/contracts/product-repository-layout.json` (this repository's own contract; it does not ship in the published package) extends the account hub's
`clossys/` layout to a product repository: `apps/*`, workspace wiring so
`@clossys/*` packages install as exact pinned versions, `AGENTS.md` /
`CLAUDE.md` pointers, and the CI Starter proof (#1215). A cloud agent
session (browser plus GitHub, no local setup) can pick up a product
repository too -- `checkCloudSessionBootstrap()` verifies exactly what that
session needs: a resolvable `package.json` plus `package-lock.json` pair,
an `AGENTS.md` that mentions `clossys/`, and a hub marker at the same
relative path as the packed template `skeleton/clossys/.state/workspace.json`.
It never runs `npm ci` itself and never mutates anything; it only reports
which of the three is missing.

## Inventory: adopting an existing source

When an account already keeps a repository inventory in its own control
plane, launcher reads it as the source of truth instead of writing a
second, diverging one (#1216). Declare it by hand-editing the hub marker (the packed template
`skeleton/clossys/.state/workspace.json`; the generated path does not
ship) to add an `externalInventory: { path, shape }` field (a `"foundry"`
or `"custom"` shape). Every `launcher` run
(create, resume, or appoint) then calls `reportInventoryDrift()`
automatically and prints the result in hub health output when the marker
declares one: three sets, all three even when one is empty -- ids only in
the external source, ids only in launcher's own inventory, and ids both
agree on. A `"custom"` shape is reported indeterminate rather than guessed
at -- launcher has no mapping for a non-foundry inventory shape yet. It
never merges the two silently; writing the reconciled set is left as a
separate, explicit apply step for a follow-up.

## Hosts

Every `launcher` run (create, resume, or appoint) records which
coding-agent hosts a directory could already discover skills through,
*before* that run composes skills and stamps every host's discovery path
(#1180): `claude-code` and `cursor` are detected by their own discovery
symlink (`.claude/skills`, `.cursor/skills`); `codex` is detected by the
presence of `.agents/skills` itself, since Codex reads repository skills
from that path directly and needs no separate discovery link (verified
against developers.openai.com/codex/skills, 2026-09-22). The snapshot is
written to `clossys/.state/hosts.json` (`HOSTS_REL`, via
`serializeHostRecord()` / `parseHostRecord()`) for the hub and for every
sibling clone launcher composes skills into -- so a consumer such as
Advisor's next-action phrasing can name the client's actual tool instead
of guessing.

## Model guidance

Packages declare what a step demands -- a reasoning tier (`light` /
`standard` / `deep`) -- never a model name (#1219). Launcher ships the
tier-to-model mapping per host in `model-profiles/<host>.json`, dated and
re-verified against that host's real current models;
`readHostModelProfile()` reads one. `parsePreferences()` reads
`clossys/preferences.json`'s budget stance (`cost-conscious` / `balanced` /
`max-quality`, defaulting to `balanced` when absent or malformed) --
Advisor asks the question and writes the file; this package only resolves
against it. `resolveModelForTier()` combines a profile, a tier, and a
preference into one `ModelResolution`, and reports `belowFloor` rather than
silently substituting a weaker model when a caller-supplied hard floor
tier cannot be met.

## Applying an approved plan

`launcher-apply-plan --plan <plan.json> --brief <brief.json> --repo <dir>`
writes `clossys/brief.json` into a staffed repository once the plan is
approved (#1178). `validateAdvisorPlan()` and `validateEngagementBrief()`
check both files against the shared contracts in this repository's
`docs/contracts/` -- `advisor-plan.json`, `engagement-brief.json`, and
`engagement-context.json` for the brief's `context` snapshot (#1475). This
package's build packs those files, with a copy of the one contract checker
`@clossys/advisor` uses, so Launcher and Advisor accept exactly the same
plans and briefs while Launcher keeps no runtime dependency on Advisor.
Every object is closed: a field the contracts do not declare is refused,
and a known context value must be one of that field's fixed choice ids,
because the brief is committed in every staffed repository. A string or
key containing a lone surrogate is refused, so every plan that validates has
a digest. Every plan time must be a real calendar date or date-time in
ISO 8601 form, a date-time with `Z` or a `±hh:mm` offset, checked
field by field (so `2026-02-30` or `T24:30` is refused). A brief's
`problem`, `role`, `why` and `metric` must contain a non-whitespace
character, and an item of `inputsFrom`, `outputsTo`, `sequence` or
`deliverables` must not be empty. A refusal names each declared field at
fault and never echoes its value, and never names a key the contracts do
not declare: such a field is reported at the object that holds it, by its
1-based position there (`plan.mandate has a field the contract does not
declare (key 4 of this object), and unknown fields are refused`), counted
in the order the file wrote the keys when `launcher-apply-plan` reads it; a
value a caller passes to a validator directly is counted in JavaScript's
own key order, which lists array-index keys such as `"7"` first.
`launcher-apply-plan` reads both files as strict JSON: bytes that are not
valid UTF-8, a leading byte order mark, or an object that repeats a key at
any depth exit `2`, with a repeated key reported by its position in its
object and, below the top level, that object's position, never by name,
and a syntax error by position only, never quoting the file's text, so the
value validated is exactly the one a reader of the file sees. A position is
a 0-based index into the decoded text in UTF-16 code units (JavaScript's
string index): the byte offset for ASCII text, with a character outside
the Basic Multilingual Plane counting as two.
A plan may say which roles work in which repository (`staffing`, by
repository inventory id), which kits were recommended (`kits`), which exact
package acts are authorized (`packages`, each one exact version and one
`sha512-` integrity value) and where those versions were resolved from
(`resolution`) (#1178). Once the schema passes, the contract's code rules
run: no repository is staffed twice (ids compare case-insensitively),
every staffed role is one of the mandate's roles and every mandate role is
staffed somewhere unless it is a hub-only role, every
package act names a staffed repository spelled exactly the same, no
`planItem` repeats, no package appears twice in one repository,
`resolution` is present exactly when `packages` is, no kit id repeats, no
role repeats within one staffing entry, no role is named twice in
`mandate.roles`, a repository has at most one `pin-starter` act, always
placed in `devDependencies`, and no hub-only role is staffed. The hub-only
roles, Advisor and Integrator, are read from the plan contract's
`definitions.hubOnlyRoles`, the same data Advisor reads. The rules read only a document's own fields,
as the schema does, so an inherited one is ignored. A brief's optional `staffedHere`
must name only the brief's own roles, each once. This package implements
those rules separately from Advisor, and both are tested against the same
corpus, `docs/contracts/advisor-plan-rules.fixture.json` (in the public
repository, not shipped in this package).
`approvedSubject()` says what an approval binds: the `subjectDigest` of the
plan's most recent decision (by timestamp, not array position) when it is
`"approved"`. It validates the plan itself first and returns null for one
that does not validate. An approval with no `subjectDigest` binds nothing,
and so does no decision at all, a decision time that does not parse, or a tie at
the latest instant between decisions that disagree or name different
subjects. It says what was approved, not that it matches: a caller must
recompute the digest of the change it holds and compare.
`isPlanApproved()` reads the same most recent decision and is true when it
is `"approved"`, with the same rules for ties and unreadable times, but it
binds no bytes: it ignores `subjectDigest`, so it is also true for an
approval that names no change. Anything that applies a plan must use
`approvedSubject()` instead.
`applyEngagementBrief()` and `launcher-apply-plan` are the brief-only path,
which predates that binding and is kept as it was, not extended: they
require `isPlanApproved()` and accept an approval with or without a
`subjectDigest`, checking no binding.
`applyEngagementBrief()` refuses, and writes nothing, unless all three
checks pass and the plan's digest is computed; only then does it write the brief byte-identically -- it never re-authors
its prose -- and reports `planDigest()` of the plan it applied, which the
CLI prints as `plan digest sha256:...`. That digest is defined once, in
`docs/contracts/advisor-plan-digest.md` (in the public repository, not shipped in this package);
this package and Advisor each
implement it and are tested against the same fixture corpus. On this
brief-only path, this package does not compute the brief's content -- it
writes the brief it is given, which `@clossys/advisor`'s
`toEngagementBrief()` builds, and applies no per-repository projection --
and it does not decide whether a plan should be approved (that is
Advisor's job); it only validates the two shapes and writes the one file.
The apply planner below is different: it projects each repository's brief
from the hub brief itself.

### Computing each repository's change

`planApplyBundle()` computes, for each repository a plan staffs, the change
set one pull request would make there, and a bundle that holds them (#1178).
It is pure: it takes the plan, the hub brief (`clossys/advisor/brief.json`),
what the caller observed on each repository's default branch, the composed
skill text for each role, this package's version and the hub's Advisor pin,
and it reads nothing itself. The shapes are the shared contracts
`docs/contracts/repository-change-set.json` and `apply-bundle.json`, packed
into this package, and every set and the bundle are validated against them,
code rules included, before they are returned. The digests are defined in
`docs/contracts/apply-change-set-digest.md`, with a corpus computed
independently of this package (both in the public repository, not shipped
in this package).

- Each set describes the repository's brief, projected from the hub brief with
  `staffedHere` set to its roles and, unless the repository is private, the
  brief contract's fixed placeholder in place of the client's problem. It
  holds each staffed role's skill, carries every package act the plan
  names for that repository, and names the installed-state ledger as a
  derived file. In a `setup` set an `install` is listed under `deferred`
  for the later `apply` set, so no act the plan authorizes is dropped and no
  other act is added. An act the default branch already satisfies exactly
  is kept with `satisfiedInBase: true` and writes nothing.
- A file the set would write whole, or a `package.json` key it would
  change, that the default branch already has is refused as
  `unowned-existing`: the planner treats the installed-state ledger as empty
  and never takes over bytes it cannot show the flow wrote. The lockfile and
  the ledger are derived files, checked by their invariants, and are not
  refused this way.
- The change-set digest leaves out what is computed from it or from what it
  covers -- the digest itself, the branch, the bundle digest, the pull
  request text and the inverse set -- and `tooling`, which records the
  machine. It also leaves out a derived file's `before` and `after`, for two
  different reasons: the ledger's bytes cite the digest, and a lockfile's
  bytes depend on the package manager's version, so both are checked by
  their invariants, which stay covered. Only those two files may be
  derived. So a moved base, a different Launcher version, a visibility
  change, a staffing change, different package bytes or a different ledger
  generation is a new set, and recomputing any excluded value is not.
- Every array whose order carries no meaning is written in one canonical
  order, and the contract refuses any other order, so observing the same
  repository twice, in any order, gives the same bytes and the same digest.
  The contract's code rules also tie each kind of item the planner computes
  to exactly what it writes; the acts nothing computes yet are declared but
  not yet tied to their files.
- The bundle digest covers only the plan digest and each computed
  repository's id and change-set digest, so an approval can bind it and a
  repository can recompute it from digests alone.
- The bundle's `mode` is `report`, and it records no repository state. The
  checks that would let a repository be called planned -- the installed-state
  ledger and package provenance -- are not run here. The bundle reports the
  planner's own dry-materialization check (V6), which covers the file
  layout only: the part of V6 that regenerates the lockfile and checks its
  invariants is not run, so a set that changes a lockfile carries V6
  `indeterminate` with rule `lockfile-not-run`, and V6 is `satisfied` only
  for a set with no lockfile change. A `setup` set is also `indeterminate`
  until the setup template exists (`setup-template-unbuilt`). Two V3 checks
  need no observation: when the authorization names a different plan
  digest than the plan's, every computed repository gets a violated V3
  check (`authorization-plan-mismatch`), and when the plan has package acts
  and no authorization is given, every computed repository gets a violated
  V3 check (`authorization-absent`). Each repository's verdict is the worst
  of its checks.

Nothing here writes to a repository, creates a branch or opens a pull
request; reading the repositories, installing packages and opening one pull
request per repository are not built yet.

## Taking the registry snapshot

`launcher-apply-plan snapshot --request <file> [--out <file>]` takes the
registry snapshot a plan's exact packages are resolved from (#1178). It is
the only step of applying a plan that reads the package registry. It records what the
registry said; it decides nothing from it. Deciding is
`advisor-resolve-packages`'s job, in `@clossys/advisor`.

- **Request.** `<file>` holds the report `advisor-package-request` prints,
  `{ "state": "satisfied", "names": [...], "findings": [] }`, or just
  `{ "names": [...] }`, read as strict JSON (invalid UTF-8, a byte order
  mark or a repeated key is refused). Every name must be a scoped package
  name in the publishing scope this package was built with, and appear once.
  A request with another field, another state or any finding is refused
  before anything is fetched.
- **Fetch.** For each name, in name order and one at a time, a `GET` of
  the package's full registry document at `{registry}/{name}`, with the slash
  in the name percent-encoded (`@scope%2Fname`), the same encoding
  `@clossys/integrator` uses. The registry is the one in this repository's
  `package-scope.json`, packed into this package at build time.
- **Transport.** Node's own `fetch`. The only headers this step sets are
  `accept: application/json` and `accept-encoding: identity`, and never an
  `Authorization` header; Node's fetch adds its own default, non-credential
  headers. The step does not run the npm CLI, and reads no
  `.npmrc` and no token from the environment. If Node is started with an
  environment proxy (`NODE_USE_ENV_PROXY`), requests go through that proxy.
  No registry credential is ever sent; a username and password written in
  the proxy URL itself are sent only to that proxy, as Node's fetch does. A redirect is refused, never followed.
  `accept-encoding: identity` asks for the body uncompressed, so when the
  server honours it the size cap and `responseSha256` apply to the exact
  bytes received. A response body is
  read as a stream and abandoned as soon as it passes 10 MiB; a declared
  length over that is refused before any of the body is read. If a server
  compresses the body anyway, Node's `fetch` decodes it and the 10 MiB cap
  counts the decoded bytes, so the read is still bounded. Each request, body
  included, is abandoned after 30 seconds.
- **Answers.** A `200` is projected into the snapshot. A `404` is recorded
  as `status: "not-found"`. Anything else stops the step at that package:
  a transport error, a timeout, a redirect, any other status, an oversize
  body, or a `200` body that is not strict JSON or is not that package's
  registry document. Nothing further is fetched, no snapshot is written, and
  the exit code is `2`. An earlier snapshot at the output path is left
  untouched, and must not be used: exit `2` means this run recorded nothing.
- **Projection.** Only what the registry snapshot contract declares is
  kept: the version the `latest` dist-tag names, or `null`, and, when the
  document lists that version, that one version's integrity value and tarball
  URL exactly as served, whether it is deprecated, when it was published, and
  whether it lists attestations. Every other version, dist-tag and field is
  ignored. The document must name the requested package, and the version's
  own entry must carry the version number `latest` names; otherwise nothing
  is written. `responseSha256` is the SHA-256 of the response body's bytes
  as received; if a server compressed the body despite
  `accept-encoding: identity`, it is the SHA-256 of the decoded body.
- **Output.** The snapshot is written only after the exact text to be
  written has been read back strictly and has passed
  `docs/contracts/registry-snapshot.json`
  (in the public repository, not shipped in this package; its content is
  packed at build time), schema and code rules N1-N3 both. It goes to
  `--out`, by default `clossys/.state/apply/registry-snapshot.json` under the
  current directory, which should be the hub. It is two-space JSON with a
  final newline, with packages sorted by name, so the same registry answers
  give the same bytes apart from `fetchedAt`. `fetchedBy` is this package's
  own name and version. The write is atomic: a temporary file in the same
  directory is written, flushed to disk and renamed over the target, so a
  reader sees the old file or the whole new one.

A message names a package by its position in the request, `names[<n>]`,
never by its name, and never quotes a response or the request: a name is
request text, so the caller looks position `<n>` up in the request file it
wrote. Exit codes: `0` means the snapshot was written, or that `--help` printed
the usage;
`2` means nothing was written, whether because of a usage error, an
unreadable or refused request, or a registry answer this step cannot record.
A snapshot is a record of what the registry answered, not evidence of where
a package came from; that is shown by verifying the package's provenance,
which this step does not do.

## Why this is not Advisor, Starter, Builder, installer, creator, or a connector

Advisor is the engagement engine: it grades evidence and names a next
action. It has no GitHub I/O, and must not grow any. The composed
`@clossys-advisor` voice is hiring and compatibility in chat, not a second
engine. A remote chat connector is a separately deployed product surface for
that engine, not a repo scaffolder.

Starter (`@clossys/starter`) is the protected-base **activation** gate.
Its only v1 subcommand is `decide`. It joins a pull-request snapshot to
fixed install evidence, Advisor readiness, and one target CLI. It refuses
commands, shell, and caller-selected paths. That is why get-started is not
`npx @clossys/starter`: a no-argument Starter invocation that created a
GitHub repository would be a contract break, and stuffing `gh repo create`
into `foundry-starter decide` would be the same defect. Starter starts the
trusted-base **loop in CI**, after a hub and a workflow already exist. It
does not start the human.

Builder realizes declared live state later in operating control. A new
hub has no declared topology yet.

This package is not named installer: an install is not adoption, Starter
already owns install-evidence joins, and the hub must not dump the
catalogue. It is not named creator: that reads as a role. Launcher is the
get-started bin that puts a hub on disk so a coding agent can open it.

This package exists because `npx` runs a **package name**. Step 0 is a
bin and a skeleton, not a role. It stays executable tooling so Starter's
`decide` contract, Advisor's engine boundary, and Builder's loop stay
intact.

## Requirements

Node.js 20+, ESM, GitHub `gh`, and no runtime dependencies. The registry
snapshot step needs HTTPS access to the public registry, and no credential.
Creating a new hub needs permission to create a private repository under the
inferred owner. Appointing uses the current checkout and does not create a second
repository.

## Licence

MIT.

## Changelog

Release notes for every version are in the [changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/launcher.md), kept in the public repository rather than in the installed package.
