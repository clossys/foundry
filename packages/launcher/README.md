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
| Already a hub (generated marker; packed template `skeleton/clossys/.state/workspace.json`) | Resumes. No new repository. `--inventory` here is refused with a pointer to the appointed hub's own `clossys/.state/inventory.json`. A legacy `.clossys/` hub state is migrated automatically; see "Layout" above. |
| Any other GitHub repository you control | Appoints it as the account hub. Keeps existing product files. Refuses when the working tree has uncommitted changes (`git status --porcelain` non-empty) — the refusal names the offending remote host when the origin is not on github.com. Refuses when `CLOSSYS_OWNER` names a different account than the repository's github.com origin owner. Writes the hub marker. Pins live `@clossys/advisor` in `devDependencies`, relocating and upgrading any pin left in another bucket. A dedicated `{owner}/workspace` checkout is named `@owner/workspace`; a product repository keeps its package name. Always reads the public Advisor version (needed to pin live and to grade resume health). Refuses if the generated hub inventory is missing or empty (packed template `skeleton/clossys/.state/inventory.json`; that generated path does not ship) unless `--inventory <path>` supplies a populated document — or, when the on-disk inventory is already populated and `--inventory` is also supplied, merges the two by repository id (on-disk order first, new ids appended, first occurrence of an id wins). Does not rewrite the lockfile or dump the catalogue. Prints a read-only health report. |

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

## CLI

```bash
launcher
launcher --inventory path/to/inventory.json
launcher --clone-missing
launcher --help
launcher-check --help
launcher-check --input observation.json
launcher-doctor
launcher-apply-plan --plan plan.json --brief brief.json --repo ./product-checkout
```

Exit codes preserve the ternary:

| Exit | State | Meaning |
| --- | --- | --- |
| `0` | `satisfied` | Created, resumed, or appointed the hub. The message includes a read-only health report. |
| `1` | `violated` | Known refusal: not GitHub, not empty, missing appoint inventory, the supplier tree, uncommitted changes in the appoint tree, or a `CLOSSYS_OWNER` that disagrees with the origin owner. |
| `2` | `indeterminate` | Missing `gh`, unreadable registry pin, or an owner that could not be inferred. |

`launcher-check` grades a captured observation JSON through `planWorkspace` and does not create a hub. Same ternary: 0 is a create/resume/adopt plan, 1 is a known refusal, 2 could not run or could not decide. Appoint grades as a plan only when the observation already records a populated inventory; `--inventory` is a live CLI flag, not a check-cli input.

## API

| Export | Description |
| --- | --- |
| `planWorkspace()` | Decides create, resume, or adopt from a cwd observation. Optional `{ inventoryPath }` is the only way to appoint without a populated on-disk inventory. |
| `applyWorkspacePlan()` | Copies the in-package skeleton or hub marker through a host port and returns a `WorkspaceApplyResult` with health. Composes the same skill voices (with the shared conversation contract injected) on the hub and on inventoried sibling checkouts beside it; refreshes stale hub guidance and the generated `clossys/` README on every path, including resume; migrates a legacy `.clossys/` hub state automatically. Optional `{ skillCatalogueRoot, launcherPackageRoot, contractPath, liveLauncherVersion }` selects where skill and contract bodies are read and grades skill-manifest staleness. |
| `observeWorkspace()` | Reads `gh`, git remotes, cwd, inventory classification, hub-state migration status, and the public Advisor version. |
| `readInventoryRepositories()` | Reads repository ids from an inventory document, routed through `validateInventoryDocument()` (a missing file reads as no ids; anything present but schema-invalid throws, naming the offending field -- never silently accepted or silently emptied). |
| `readLiveLauncherVersion()` | Reads the public `@clossys/launcher` registry version, used only to grade catalogue-sourced skill staleness. |
| `launcherPackageRootFromModule()` | Resolves this package's root from `import.meta.url` so apply can find the packed skill catalogue and contract. |
| `parseGitHubRemote()` | Parses a github.com remote and rejects any other host. |
| `isHubDocument()` | Type guard for the generated hub marker (packed template: `skeleton/clossys/.state/workspace.json`). |
| `inspectInventory()` | Classifies inventory JSON as missing, empty, populated, or invalid (malformed or schema-mismatched -- never silently folded into empty; see `validateInventoryDocument()`). |
| `validateInventoryDocument()` | Strictly validates an inventory document's text against the inventory contract (#1334), which ships with this package (`schemaVersion: 1`, a `repositories` array of `{ id, packages? }` entries -- `id` a bare repository name or `owner/name` in the same format Launcher's own sibling/clone resolution requires, case-insensitively unique; `packages`, when present, shaped exactly as `@clossys/integrator`'s `InventoryPackageEntry`, no other key). Returns `{ valid: true, ids }` or `{ valid: false, reason }` naming the offending field. Every read of an inventory document -- `--inventory`, the on-disk `clossys/.state/inventory.json` (a hub path, not shipped in this package) on every resume, and `readInventoryRepositories()` -- routes through this; a document that merely resembles an inventory (for example a governance record whose entries also carry `role`, `visibility`, `status`, `notes`) is refused, never adopted or silently read as though it validated (#1334). |
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
| `CommandResult` / `CwdObservation` / `DependencyBucket` / `HubDocument` / `HubHealthReport` / `HubMigrationState` / `InventoryObservation` / `InventoryValidationEntry` / `InventoryValidationReport` / `PinFinding` / `PinGrade` / `SkillManifestDocument` / `SkillManifestEntry` / `SkillsManifestSummary` / `ApplyWorkspaceOptions` / `WorkspaceApplyResult` / `WorkspaceDecision` / `WorkspaceHost` / `WorkspaceObservation` / `WorkspacePlan` / `WorkspaceRefusal` / `WorkspaceState` | Typed host, observation, plan, health, and outcome contracts. |
| `cloneMissingInventoryRepositories()` | Explicit, approved action (#1179): clones every inventoried repository `resolveSisterCloneTargets` skipped for "not beside the hub", and only those. Returns a `CloneMissingOutcome[]`. |
| `runDoctorChecks()` | Read-only prerequisite checks in fix-in-this-order sequence: git, `gh`, signed in, Node.js, npm, then the advisory coding-agent step. Returns a `DoctorReport`. |
| `renderDoctorReport()` | Renders a `DoctorReport` one step at a time, the way `launcher-doctor` prints it. |
| `checkCloudSessionBootstrap()` | Read-only: the three product-repository-layout.json cloud-session-bootstrap checks against a directory. Returns a `CloudBootstrapReport`. |
| `reportInventoryDrift()` | Compares a declared external inventory against the launcher-written one; reports external-only, launcher-only, and agreeing repository ids. Returns an `InventoryDriftReport`. |
| `detectLinkedHosts()` | Read-only: which of `claude-code`, `cursor`, `codex` can currently discover skills in a directory. |
| `serializeHostRecord()` / `parseHostRecord()` | Round-trip `clossys/.state/hosts.json` (`HOSTS_REL`). |
| `parsePreferences()` | Reads `clossys/preferences.json`'s budget stance; defaults to `"balanced"` on absence or malformed input. |
| `readHostModelProfile()` | Reads a packed `model-profiles/<host>.json`; returns `undefined`, never throws, on a missing or malformed file. |
| `resolveModelForTier()` | Resolves a tier and budget preference to one model name for a host, reporting `belowFloor` rather than silently substituting a weaker tier's model. |
| `validateAdvisorPlan()` / `validateEngagementBrief()` | Validation of `clossys/advisor/plan.json` and `clossys/brief.json` (with its `context` snapshot) against the shared plan and brief contracts Advisor also validates against. Unknown fields are refused; the reason names every field at fault. |
| `isPlanApproved()` | True only when a plan's most recent decision (by timestamp) has `chosen === "approved"`. False when decisions at that latest time disagree, or when any decision time does not parse. |
| `applyEngagementBrief()` | Writes `clossys/brief.json` into a repository directory once the plan validates and is approved and the brief validates; refuses and writes nothing otherwise. Reports the plan's canonical digest. |
| `planDigest()` / `canonicalJson()` / `PLAN_DIGEST_EXCLUDED_FIELDS` | The canonical plan digest an approval binds: `sha256:` over the RFC 8785 canonical JSON of the plan without `asOf` and `decisions`. Identical to Advisor's for every plan. |
| `CloneMissingOutcome` / `DoctorCheckHost` / `DoctorReport` / `DoctorStepId` / `DoctorStepResult` / `CloudBootstrapCheck` / `CloudBootstrapReport` / `ExternalInventoryDeclaration` / `InventoryDriftReport` / `DiscoveredHost` / `HostRecord` / `BudgetPreference` / `HostModelProfile` / `HostTierMapping` / `ModelResolution` / `PreferencesDocument` / `ReasoningTier` / `SupportedHost` / `AdvisorPlan` / `ApplyBriefResult` / `BlockerKind` / `EngagementBrief` / `EngagementBriefRole` / `EngagementContext` / `EngagementContextField` / `EngagementContextFieldId` / `GoalDirection` / `PlanBlocker` / `PlanDecision` / `ValidationResult` | Typed contracts for the sections above. |

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
`deliverables` must not be empty. A refusal names each field at fault and
never echoes its value; a key that is not a plain identifier is shown as an
escaped JSON string, so a control character in it cannot reach a terminal.
`launcher-apply-plan` reads both files as strict JSON: bytes that are not
valid UTF-8, a leading byte order mark, or an object that repeats a key at
any depth exit `2`, with a repeated key named (escaped) and a syntax error
reported by position only, never quoting the file's text, so the value
validated is exactly the one a reader of the file sees.
`isPlanApproved()` reads a plan's most recent decision (by
timestamp, not array position) and requires it to be `"approved"` --
absence of any decision is never treated as approval, and neither is a
decision time that does not parse or a tie at the latest instant between
decisions that disagree.
`applyEngagementBrief()` refuses, and writes nothing, unless all three
checks pass and the plan's digest is computed; only then does it write the brief byte-identically -- it never re-authors
its prose -- and reports `planDigest()` of the plan it applied, which the
CLI prints as `plan digest sha256:...`. That digest is defined once, in
`docs/contracts/advisor-plan-digest.md` (in the public repository, not shipped in this package);
this package and Advisor each
implement it and are tested against the same fixture corpus. This package
does not compute a brief's content (that is `@clossys/advisor`'s
`toEngagementBrief()`) and does not decide whether a plan should be
approved (that is Advisor's job); it only validates the two shapes and
writes the one file. Multi-repository
orchestration -- branch creation, exact package installs, adding Starter's
caller workflow, and opening one pull request per repository -- is
deferred: the landed contract does not yet specify how a plan's approved
roles map to inventory repository ids or to install/remove/relocate work
items.

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

Node.js 20+, ESM, GitHub `gh`, and no runtime dependencies. Creating a new
hub needs permission to create a private repository under the inferred
owner. Appointing uses the current checkout and does not create a second
repository.

## Licence

MIT.

## Changelog

Release notes for every version are in the [changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/launcher.md), kept in the public repository rather than in the installed package.
