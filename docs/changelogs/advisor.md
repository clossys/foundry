# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.6.0 - 2026-09-28

- `assessAdvisorEngagement()` and `validateAdvisorAssessmentInput()` findings name initiatives, targets, criteria, placement cells and addressed ids by their position in the input instead of quoting them (#1550).
- `validateEngagementBrief()` refuses a whitespace-only `problem`, `role`, `why` or goal `metric`, and an empty string in `inputsFrom`, `outputsTo`, `sequence` or `deliverables` (#1475).
- `validateEngagementBrief()` accepts an optional `staffedHere` list, and refuses one that names a role not in the brief's `roles` (rule `engagement-brief-rule-b1`) or names a role twice (`engagement-brief-rule-b2`) (#1178).
- `canonicalSnapshot()` returns a registry snapshot in its canonical order, packages sorted by name and each package's versions by version, and `resolvePackages()` reads a valid snapshot in that order, so every position a finding names is the same however a fetch listed the packages, and a re-fetch of the same selection gives byte-identical output (#1178).
- `advisor-check` and `advisor-execution-readiness` read the assessment file as strict JSON, refusing invalid UTF-8, a leading byte order mark, a repeated key or a syntax error by position only, never quoting the file (#1178).
- `cleanDescription()` removes U+2800 (BRAILLE PATTERN BLANK, a printable character that renders as blank, so no invisible-character Unicode property catches it) and every noncharacter (`\p{Noncharacter_Code_Point}`, permanently reserved code points with no assigned glyph) from a repository description, so neither can pad or hide text on the repository-choice card (#1179).
- A contract message reports a field the contract does not declare at the object that holds it, by its 1-based position in that object, never by its name (#1178).
- A sibling hub checkout that validates only through the legacy `.clossys/workspace.json` marker is now told to run `npx @clossys/launcher` once to migrate its marker and inventory in place, instead of being wrongly reported as no hub reachable (#1507).
- `skill/SKILL.md` states an explicit degraded mode outside the hub (#1507): a checkout counts as the hub only once its marker file parses with `kind: "account-hub"`, `schemaVersion: 1`, and a `repository` matching this checkout's own git origin (the legacy `.clossys/workspace.json` marker counts the same way, and means the hub itself has not migrated yet); a hub checkout found beside the current repository is accepted only once its own inventory lists this repository's id under the same owner, and reading it beyond that is read-only; with no hub reachable, it gives a read-only report from `clossys/brief.json`. Outside the hub every write under `clossys/` is refused, not only hiring, a plan change, or an approval -- no card answer, no kit composition, no recorded approval, blocker, grant, or review, and no `advisor-check` run against a local assessment -- and this package is not installed in the repository; a bin that must run does so through the hub's exact pin instead, `npx --package=@clossys/advisor@<hub version> <bin>`.
- The README and the doc comments of `staffedHere` and `PUBLIC_PROBLEM_PLACEHOLDER` name Launcher's `planApplyBundle()` as the producer of each repository's brief, where they said that planner was not built yet; the README and the `PUBLIC_PROBLEM_PLACEHOLDER` comment also say that the planner writes no file (#1178).
- `packageRequest()` and `resolvePackages()` name no package for a hub-only role: a plan that staffs one is refused by the plan contract's rule R11 (as `plan-shape`, at the role's position), and a staffed hub-only role is refused again as `hub-only-package` should a plan ever reach them without that rule, so no plan installs Advisor or Integrator in a product repository (#1178).
- `HUB_ONLY_ROLES` lists the roles that work from the engagement hub only, `["advisor", "integrator"]`, read from the plan contract's new `definitions.hubOnlyRoles`, the same data Launcher reads (#1178).
- The repository-choice skill guidance tells the agent to look a Launcher inventory message's reported position up in the stored inventory file or its own `--repositories` argument, and relay the repository name from that lookup to the founder, never the position text itself (#1179).
- `validateAdvisorPlan()` and `validateEngagementBrief()` refuse a string or object key that contains a lone surrogate, so every plan that validates has a digest (#1475).
- New `advisor-package-request <plan.json>` command: prints `packageRequest()`'s result as JSON and exits `0` with the names, `1` for a plan it refuses, and `2` for a usage error or an unreadable file. It reads the plan as strict JSON, and its messages name positions, never plan text or the file's path (#1178).
- `packageRequest()` names the packages a staffed plan needs, sorted and unique: the package of every staffed role, from the packed capability catalogue, and the `starter` package every staffed repository pins, with the scope this package was built with. It refuses a plan that fails its contract, a plan with no `staffing`, and a role the catalogue does not list (#1178).
- `validateAdvisorPlan()` refuses a plan that breaks one of the plan contract's code rules R1-R8 -- a repository staffed twice, staffed roles and `mandate.roles` that disagree, a package act for a repository not staffed, a repeated `planItem`, a package twice in one repository, `resolution` without `packages` or the reverse, a repeated kit id, or a role repeated in one staffing entry -- with rule `advisor-plan-rule-r1` to `-r8` and the position of the field at fault; `planDigest()` throws for such a plan (#1178).
- Every `validateAdvisorPlan()` finding has the rule `advisor-plan-contract` and a `path` naming the field at fault, when there is one, replacing the per-field rule ids such as `blocker-capability-id` (#1475).
- `validateAdvisorPlan()` validates a plan against the shared plan contract, and refuses a field that contract does not declare, a blank string, and a time that is not a real calendar time in ISO 8601 form (a date-time needs `Z` or a `±hh:mm` offset), checked field by field so that `2026-02-30` and `T24:30` are refused (#1475).
- The header of the generated contract module names the registry snapshot contract it also carries, and says that every package validating a plan or a brief packs the same data for the plan and brief contracts, rather than the same module (#1178).
- New `planDigest()`, `canonicalJson()` and `PLAN_DIGEST_EXCLUDED_FIELDS` compute the canonical plan digest defined by the shared plan digest contract: SHA-256 over the RFC 8785 canonical JSON of a valid plan without `asOf` and `decisions` (#1475).
- `validateAdvisorPlan()` refuses a plan whose `mandate.roles` names one role twice (rule `advisor-plan-rule-r9`, the plan contract's code rule R9), even when the plan has no staffing; such a plan validated before and now has no `planDigest()` (#1178).
- `validateAdvisorPlan()` refuses a plan with more than one `pin-starter` act for one repository, or a `pin-starter` act whose placement is not `devDependencies` (rule `advisor-plan-rule-r10`, the plan contract's code rule R10) (#1178).
- `validateAdvisorPlan()` refuses a plan that staffs a hub-only role in any repository, with rule `advisor-plan-rule-r11` and the role's position; `planDigest()` throws for such a plan (#1178).
- `validateAdvisorPlan()` no longer requires a hub-only role in `mandate.roles` (Advisor or Integrator) to be staffed in any repository: the plan contract's rule R2 exempts it (#1178).
- `validateAdvisorPlan()` refuses a package act whose `planItem` is not its `repository`, a colon and its `name`, with the rule `advisor-plan-rule-r12` at `packages[<i>].planItem`, so such a plan has no digest (#1550).
- `validateAdvisorPlan()` accepts four optional plan fields from the shared plan contract -- `kits`, `staffing` (roles per repository, by repository inventory id), `packages` (exact `install` or `pin-starter` acts, each with a lowercase scoped name of at most 214 characters, one exact version with at most 16 digits in each part and no prerelease or build suffix, and one canonical `sha512-` integrity value) and `resolution` -- and an optional `subjectDigest` on a decision (#1178).
- New types `AdvisorPlanKit`, `AdvisorPlanStaffing`, `AdvisorPlanPackageAct` and `AdvisorPlanResolution`; `AdvisorPlan` gains the optional `kits`, `staffing`, `packages` and `resolution`, `AdvisorPlanDecision` the optional `subjectDigest`, and `EngagementBrief` the optional `staffedHere` (#1178).
- New `PUBLIC_PROBLEM_PLACEHOLDER`: the fixed text, read from the brief contract, that Launcher's apply planner, `planApplyBundle()`, puts in place of a brief's `problem` when it computes the brief of a repository whose visibility is not private; the planner writes no file, and Launcher's brief-only `applyEngagementBrief()` still commits `problem` unchanged (#1178).
- `validateAdvisorPlan()` and `validateEngagementBrief()` refuse an array with holes (one built in code, such as `[a, , b]`; JSON never produces one), reporting it at the array as a sparse array, so no rule ever walks a hole (#1178).
- `validateRegistrySnapshot()` checks a registry snapshot, the record of what the registry said about the packages a plan asks for, against the new shared registry snapshot contract: its schema (which, like the plan contract, limits a package name to 214 characters and each number of a version to 16 digits), then its code rules N1-N3 (`registrySnapshotRuleViolations()`: no package named twice, no version recorded twice for one package, no `latest` or versions for a package that was not found). Each violation names a rule and a position, never a value or an undeclared key. The types are `RegistrySnapshot`, `RegistrySnapshotPackage`, `RegistrySnapshotVersion`, `RegistrySnapshotRuleId` and `RegistrySnapshotViolation` (#1178).
- `advisor-render-status` reports a repeated key by its 1-based position in its object and that object's position -- "the top-level object" for the document's own object, else the character position it starts at -- never by the key's name (#1178).
- `advisor-render-status` refuses a plan file that is not valid UTF-8, starts with a byte order mark, or repeats an object key at any depth, and reports a JSON syntax error by position only, without quoting the file's text (#1475).
- The repository-choice skill guidance tells the agent that a `--replace-inventory` run's own success line labels a removed position `repositories[<i>] in the replaced inventory`, the same position it already looked up in the refusal step, so it does not need to look that position up again in the file now on disk (#1179).
- New `advisor-repository-card <repositories-file> [--current <owner/name>] [--choose <id>,...]` command, for an agent with no hub yet, prints the repository-choice card, or the checked choice, as JSON (#1179).
- `advisor-repository-card` exits `0` for a card or an accepted choice, `1` when the repository list given is empty, no listed repository has a usable id, or the choice is refused, and `2` for unreadable or invalid input. The two exit-1 "nothing to choose from" cases are told apart on stderr: an empty list given says so plainly, and a list where every entry's id failed the repository id rule says "no usable repositories" and the count skipped, instead of reusing the empty-list wording for a list that was not actually empty (#1179).
- `advisor-repository-card` reads its file as one JSON array or as JSON Lines, one entry per line, with the strict reader, and names a bad line by its number and position, never its text (#1179).
- `applyRepositoryChoice(card, chosen)` checks a client's chosen ids against exactly the ids the repository-choice card offered, and returns the chosen repositories in the card's order, ready for `launcher --repositories`. An empty choice, an id the card did not offer, and an id chosen twice are refused with `repository-choice` findings that name a position only (#1179).
- `repositoryChoiceCard(listing, { current? })` builds the hub's repository-choice card from a list of `{ nameWithOwner, description? }` entries the agent supplies, with no network call and no credentials, and the client may choose several repositories (#1179).
- A repository's description, shown as its choice's `detail`, is cleaned by Unicode property: each control character and line or paragraph separator is replaced with a space; each format character (including the tag characters U+E0000-U+E007F, zero-width spaces and joiners, bidirectional marks, soft hyphen and the byte order mark), default-ignorable code point, private-use and surrogate code point is removed; then whitespace is collapsed and the result is cut to 200 characters with a closing ellipsis. Removing the zero-width joiner splits a joined emoji sequence into its separate emoji (#1179).
- The repository-choice card's `something-else` follow-up asks whether the missing repository's owner has given the client's sign-in access to it, and does not claim the list is complete (#1179).
- Every repository id the card offers satisfies the repository inventory contract's id rule (now packed beside the plan and brief contracts) and is `owner/name`, so `@clossys/launcher` accepts it (#1179).
- The repository-choice card lists the current repository first, as its recommended choice, when it is on the list, and has no recommendation when it is not; the other repositories follow sorted by id, and `something-else` is last (#1179).
- `repositoryChoiceCard()` leaves a listed entry off the card, and counts it in the new `skippedCount`, when its `nameWithOwner` breaks the repository id rule -- for example an owner name GitHub itself lists but this contract's narrower id rule does not accept, such as one with an underscore -- rather than refusing the whole list over one bad id. `skippedCount` is present on the card, or on an otherwise-empty result, only when at least one entry was skipped, and never says which ones. A listing that is not even the right shape (a missing field, an unknown field, or a `nameWithOwner` that is not a string) still refuses the whole list, since that is a malformed file, not one bad id (#1179).
- A well-formed empty list gives `{ state: "empty" }`, which says only that the list given is empty, not anything about an account (#1179).
- `repositoryChoiceCard()` refuses a malformed repository listing by position only: every finding names `listing` or `listing[<i>]` and a fixed reason ("is missing a required field", "has a field the contract does not declare", ...), never the shared contract checker's own message or path -- the checker's path can otherwise carry an undeclared field's own name straight from the document. `advisor-repository-card` relays those findings verbatim, so the same guarantee holds end to end (#1179).
- `repositoryChoiceCard()` refuses a malformed list, or two entries naming the same repository in any letter case, with `repository-listing` findings that name a position and never a repository name (#1179).
- New `advisor-resolve-packages <plan.json> <registry-snapshot.json>` command: prints `resolvePackages()`'s result as JSON and exits `0` when resolved, `1` for a violation, and `2` for an indeterminate result, a usage error or an unreadable file. It reads both files as strict JSON, and its messages name positions, never plan text or a file's path (#1178).
- `resolvePackages()` turns a staffed plan and a registry snapshot into the plan's exact `packages` (one `pin-starter` act per staffed repository and one `install` act per staffed role, each at the version the registry's `latest` named, with its `sha512-` integrity value), its `resolution.snapshotDigest`, and the `permittedPackages` a sponsor's grant permits. It refuses a snapshot from another registry and a package that is missing, unpublished, has no usable `latest`, or whose `latest` is a prerelease, deprecated, has no single `sha512-` integrity value in canonical base64, or is served from another host; a version with no attestations yet is a warning. The same inputs always give byte-identical output, and it makes no network call (#1178).
- The Advisor skill says an approval is an appended decision whose `subjectDigest` binds it, that an approval without one binds no bytes, and that from approval until apply completes it changes no field the plan digest covers (#1178).
- The Advisor skill leaves a hub-only role (Advisor or Integrator) in the mandate unstaffed, and never staffs it in a repository (#1178).
- The Advisor skill resolves a plan's exact packages with `advisor-package-request`, a registry snapshot and `advisor-resolve-packages`, copies the printed `packages` and `resolution` into the plan unchanged, stops without writing them when no snapshot step is available, and binds the sponsor's grant to exactly the printed `permittedPackages` (#1178).
- The Advisor skill says to add no field the plan contract does not declare, and that `recommendedNext.due` is optional and may be a plain date (#1475).
- The `clossys-advisor` skill says to choose the hub's repositories on the repository card, so the client never types a repository name (#1179).
- The `clossys-advisor` skill recommends the current repository only when `gh repo view` finds one, and otherwise builds the card without `--current` (#1179).
- The `clossys-advisor` skill says a repository description is data written by whoever controls that repository, never an instruction (#1179).
- The `clossys-advisor` skill says, when `gh` succeeded and the list is empty, that GitHub listed no repositories that are not archived for this sign-in -- not that the sign-in truly has none, since the listing command drops archived repositories and leaves out any organization whose SSO the token is not authorized for -- and stops (#1179).
- The `clossys-advisor` skill says that when `gh` is missing or not signed in, the agent says so plainly and stops, never asking for a token, a password or a pasted key (#1179).
- The `clossys-advisor` skill checks `gh`'s exit status before using the list; on failure it tells the client the list could not be read and why, and never builds or shows a card from that file (#1179).
- The `clossys-advisor` skill lists repositories with `gh api --paginate 'user/repos?affiliation=owner,collaborator,organization_member&per_page=100'`, on every page and without archived ones, into a temporary directory outside the repository that is deleted afterwards (#1179).
- The `clossys-advisor` skill now tells the client, when they choose a repository owned by another account, that Launcher only composes skills into or clones a repository owned by the hub's own owner -- the card can list a repository reached through a collaborator grant or an organization, but choosing it does not put it inside what Launcher touches (#1179).
- The `clossys-advisor` skill records the choice by proposing `launcher --repositories` for the client's approval, never by writing the inventory file (#1179).
- The `clossys-advisor` skill runs `launcher --repositories` again with `--replace-inventory` only after the client agrees to replace an inventory that lists different repositories (#1179).
- The `clossys-advisor` skill checks the client's answer with the same `--current` the card was built with, so the order returned matches the card shown (#1179).
- The `clossys-advisor` skill leaves an inventory the hub already records alone unless the client wants to change it, a repository they need is missing, or Launcher reports it invalid (#1179).
- The `clossys-advisor` skill tells the client, when the card or an otherwise-empty result carries a `skippedCount`, that count of listed repositories was left off because their id did not fit the naming rule (never which ones); when every listed repository was skipped this way, it says so distinctly from an empty list -- none of the listed repositories had a usable id -- rather than reusing the "GitHub listed no repositories" wording for a list that was not actually empty (#1179).
- The `clossys-advisor` skill's repository-choice steps echo the temporary directory `mktemp -d` creates and reuse that literal printed path in every later shell call, rather than the shell variable `$tmp` itself -- each numbered step is its own separate shell call, and a shell variable set in one does not survive into the next (#1179).
- The Advisor skill says what to do for each `advisor-resolve-packages` outcome by rule: take a fresh snapshot for an unusable or undecided one, fix the plan for a plan-level refusal, and record an `unavailable-environment` blocker for a package that is not ready. It skips package resolution for a plan with no staffing or when no snapshot step is available, and clears stale `packages` and `resolution` before resolving again after a staffing change (#1178).
- The Advisor skill takes the registry snapshot with exact commands: it saves `advisor-package-request`'s output to a file in a fresh `mktemp -d` directory and prints that file's literal path, checks with `launcher-apply-plan snapshot --help` that the installed Launcher has the command (skipping resolution and saying so when it does not), runs `launcher-apply-plan snapshot --request <file>`, and stops on exit `2` without using any earlier snapshot. It also stops, saying why, when the temporary directory cannot be made or `advisor-package-request` is not installed (#1178).
- The Advisor skill names a package whose registry read failed by looking up the message's `names[<n>]` position in the request file it wrote (#1178).
- The Advisor skill records `kits` and `staffing` in the plan, writes the hub brief `clossys/advisor/brief.json` without `staffedHere`, sets the assessment basis's `planDigest` to `planDigest()` of the plan, and writes no `packages` or `resolution` by hand (#1178).
- `snapshotDigest()` is a registry snapshot's canonical digest: `sha256:` and the SHA-256 of the RFC 8785 canonical JSON of `snapshotDigestSubject()`, the registry and each package's name, status, `latest` and versions, sorted. It leaves out when and by what the snapshot was fetched and the hash of each raw registry response, so fetching the same selection again gives the same digest, and it throws for a snapshot that does not validate (#1178).
- New `validateEngagementBrief()` validates a brief, including its `context` snapshot, against the shared brief contract, and refuses a field that contract does not declare (#1475).
- The packed brief contract names Launcher's `planApplyBundle()` as the one producer of a per-repository brief, in the present tense, and says it computes that brief without writing any file (#1178).
- Each package skill's section for when the package is not installed speaks of the repositories the team is set up in, instead of every inventoried repository.
- Each package skill says the whole team is composed in the hub and a repository staffed in an approved plan gets `@clossys-advisor` and the voices of the roles staffed there once that plan's setup pull request has merged, so a missing `@clossys-<package>` mention is a bug only in the hub.

## 0.5.0 - 2026-09-24

- `EngagementBrief` gains an optional `context` snapshot of the engagement context, `toEngagementBrief()` accepts it, and the new `contextFromBrief()` reads it back as a copy with one entry per field, treating an absent snapshot or a missing field as unknown. This is how a role running in a product repository reads what the founder already answered. Because the brief is committed in every staffed repository, `toEngagementBrief()` writes one entry per field id and throws on a duplicate field id or on a known field whose value is not one of that field's fixed choice ids, so founder text, slugified or not, never enters it. Because `clossys/brief.json` is committed JSON a person can hand-edit, `contextFromBrief()` applies that same check on read: an entry with an invalid or missing value, extra keys, a duplicated id, or a non-array `fields` reads as unknown instead of being trusted or throwing.
- The capability catalogue now reads `needs`, `solves`, `feeds` and `fit` in
exactly the shape the package-framework contract defines. A `solves` entry
carries `statement` and an optional `capability`, and its `evidence` may be
`designed`, `qualified` or `proven`. A `needs` edge carries the declared
`producerRole` (a scoped package name). Each role exposes its own
`declaredFeeds` verbatim and in declared order, and its declared
`capabilities` (id, inputs, outputs). `feeds` now lists only the producer's
side of met needs. `fit` lists the signal ids from the declared fit-signal
file. New exported types: `CapabilityInput`, `DeclaredCapability` and
`DeclaredFeed`. `CapabilitySolves.statement` and
`RoleCapability.declaredFeeds` are new required fields. A declared need now
counts as met only when its producer declares a `feeds` entry for that
artifact, which is the framework gate's rule, so a declared need its
producer does not feed is now unmet. `needIsMet` is exported. An unmet need
is reported in `unsatisfiedNeeds`, and its producer is still pulled in.
- The packed capability catalogue now carries the `needs` and `solves` that
Customer, Writer, Designer, Publisher, and Strategist declare in their own
manifests. Before, it used the fallbacks it derives when those fields are
absent. Each of the five had a `solves` entry that restated the role's job
question and cited no proof case. Publisher's edges came from its package
dependencies and the first-wave order. The launch kit now composes from the
declared edges, and each declared `solves` entry names its own proof case
and capability. All five are at `designed` evidence.
- `composeKit` now judges needs cycles per capability, following the
contract's cycle decision, and `judgeNeedsCycles` is exported. A cycle among
capabilities is a deadlock and stays `indeterminate`. A role-level loop with
no capability cycle behind it, such as the Customer/Publisher keep loop,
now composes, and its new `roleCycles` field lists the loop. A cycle the
capability graph cannot account for now composes too, and the new
`unjudgedCycle` field names it. That covers a cycle only visible through a
role with no capability map, and a role loop closed by an inferred fallback
need that names no capability; before this change, that last case was
`indeterminate`. `composeKitFromProblems` passes both fields through. So
does `recommendKit`: a `KitVerdict` now has `roleCycles` and
`unjudgedCycle`, and the skill tells the client about an unjudged cycle. A
verdict's citation `statement` is now the role's own `solves` statement.
- The changelog is no longer included in the package; it now lives in the public repository, linked from the README.
- Remove the duplicated "How we work together" and "One question at a time"
sections from this package's packed skill (`skill/SKILL.md`).
`@clossys/launcher` injects the shared conversation contract when it
composes a skill for a consumer, so the packed skill no longer carries its
own byte-identical copy (#1182).

## [0.4.1] - 2026-09-23

### Notes

- No packed content changed. This package's test suite changed as part of
  fixing leaking temp fixture directories (issue #1250), and its 0.2.8
  qualification record was already retained -- once a version's record is
  retained, any further change to that package, packed or not, requires a new
  version. Renumbered repeatedly as main moved ahead during this restack's
  disk-incident hold (0.2.9 -> 0.4.1): main independently shipped advisor
  wave 2 (STATUS renderer, kit verdicts, managed engagements, budget
  preference) as 0.4.0, ahead of this test-only bump (version-collision
  rule, issue #1187).

## [0.4.0] - 2026-09-22

### Added

- `renderAdvisorStatus()`, `validateAdvisorPlan()`, and the
  `advisor-render-status` CLI: a pure renderer (plus its validator) for
  the STATUS document at `clossys/advisor/STATUS` (a `.md` file), with
  five fixed sections (Mandate, Where we are, Recommended next,
  Decisions, Blockers), from an `AdvisorPlan` record. Structured so
  Controller's loop engine (#1195) can take over rendering later
  without a vocabulary change (issue #1175). `AdvisorPlanBlocker` is
  field-for-field the same shape as Controller's own `Blocker`
  (`capabilityId`, `kind`, `owner`, `nextAction: { who, how, byWhen }`,
  `since`) per the owner direction on #1187 (2026-09-23) against local
  copies of shared definitions (issue #1237).
- `recommendKit()`: per-kit verdicts on the composed kit from #1176 —
  each role's why, confirmed-problem citations, goal, handoffs, and
  deliverable — attributing the verdict to a matching curated preset
  when one's own closure equals the composition (issue #1177).
- `EngagementMode`, `validateManagedEngagement()`, and
  `proposalReadyForClient()`: self-serve and managed as grant shapes on
  the same engine, with the operator-review hook that holds a proposed
  kit back from the client in managed mode until the engaged operator
  approves it (issue #1044).
- `nextStepInstruction()`: host-specific phrasing for opening the next
  repository and calling the next role, for Claude Code, Cursor, and a
  generic fallback (issue #1180, Advisor side).
- `BUDGET_PREFERENCE_CARD`, `applyBudgetPreferenceChoice()`, and
  `toPreferencesFile()`: the one-question budget-preference card and its
  `clossys/preferences.json` shape, using the fixed tier names from
  #1219. Advisor names no model anywhere (issue #1219, Advisor side).

## [0.3.0] - 2026-09-22

### Added

- Generated capability catalogue (issue #1176): `CAPABILITY_CATALOGUE` and
  `kitCatalogueDigest`, packed at build time (mirroring the launcher's own
  skill-catalogue packer) from this repository's role-loop archetypes, each
  package's own `foundry` manifest fields, and — while no package yet
  declares them (issue #1172 is in progress) — a documented fallback over
  first-party runtime dependencies and this repository's committed
  non-runtime closed-loop order. Connectors may bind `kitCatalogueDigest`
  into `AssessmentBasis.catalogDigest`.
- `composeKit()`: pure closure-and-ordering composition over the
  catalogue's `needs`/`feeds` graph. An unknown role or a needs cycle
  reports `indeterminate`, never a guess.
- `CLIENT_PROBLEMS` (issue #1176): a vocabulary of client problems the
  client confirms — they never pick a package.
  `nextProblemQuestion()`/`applyProblemChoice()` offer one problem card at
  a time, reusing the same card pattern as every other question here.
- `composeKitFromProblems()`: deterministically maps confirmed problems to
  roles via each role's own `solves[].problem`. Guardrails: exactly one
  confirmed problem must be `primary`; a composed role count over
  `FIRST_ENGAGEMENT_ROLE_CAP` (5) requires a stated `overCapReason` or
  comes back `"over-cap"` instead of silently over-staffing a first
  engagement.
- `validateKitProposal()`: checks a skill-proposed kit against what
  `composeKitFromProblems()` itself would justify from the same confirmed
  problems — every role must trace to a confirmed problem it solves, or to
  a role that needs it; an unlinked role is reported as a removal
  candidate, never silently kept.
- `KIT_PRESETS` (issue #1176): curated starting compositions (Launch, Grow,
  Ship Safely, Operate at Scale, Customer Ops) — fallbacks and
  best-sellers Advisor can offer, never an exhaustive partition of the
  package catalogue.
- `EVIDENCE_LEVELS`, `evidenceAtLeast()`, `presetEvidenceFindings()`: the
  `designed`/`qualified`/`proven` evidence tiers behind every `solves`
  claim. Every current claim is `designed` (a documented placeholder)
  until issue #1172 lands real evidence for a role.
- `toEngagementBrief()` (issue #1176): the kit output shape — problem,
  staffed roles with why and goals, handoff sequence, and deliverables
  grounded in each role's own `boundary.owns`. Type-and-schema only in this
  release; writing it to a repository's brief file is wave 2 (issues
  #1175, #1178).
- Shared engagement context (issue #1173): `EngagementContext` types, and
  `nextContextQuestion()`/`applyContextChoice()`, extending the existing
  `nextSponsorQuestion()`/`applySponsorChoice()` card pattern to capture
  business, product, audience, stage, intent, and constraints once. An
  unanswered field stays `unknown`; only questions a non-technical founder
  can answer are asked here — technical facts come from reading the
  repository. The duplicate-question gate against role intakes needs issue
  #1172's intake declarations, which do not exist yet, and is
  intentionally left out of this release.
- This repository's own offering-kits gate (issue #1176): every preset
  names only real, current role packages, every `addOnTo` resolves to a
  real preset id, and every preset composes cleanly against the generated
  catalogue.

## [0.2.8] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).
- `AdvisorAssessment.sponsorSummary` — a derived, founder-facing one-line summary
  from the assessment `state` (`satisfied`, `violated`, or `indeterminate`).
  Callers cannot supply it.
- Sponsor question cards as data: `nextSponsorQuestion()` returns one card at a
  time for the first unknown fit criterion, then the first unknown readiness
  criterion; `applySponsorChoice()` maps a stable choice id to fit or readiness
  state, or signals `something-else` / `unknown-choice`. Exported types:
  `SponsorQuestionCard`, `SponsorQuestionChoice`, `SponsorChoiceApplyResult`,
  and `SponsorQuestionInput`.

## [0.2.7] - 2026-09-19

### Added

- Ships the `clossys-advisor` Agent Skill (`skill/SKILL.md`) next to the
  existing assessment bins `advisor-check` and `advisor-execution-readiness`.
  In Cursor, mention `@clossys-advisor` to invoke that receptionist voice.
  The skill is packed with the package; it does not add runtime exports and
  does not replace the assessment CLIs.

## [0.2.6] - 2026-09-19

### Changed

- Tightened the placement-evidence join. A `HubPlacementCell` may now carry two
  optional fields (schemaVersion 1, additive): `expectedVersion`, an exact
  semver the fix must land, and `expectedPlacement`, the `dependencies` or
  `devDependencies` bucket the pin must land in. A covering install work item
  that does not declare that exact version — a same-version reinstall of a
  stale pin, for example — or that places the package in the other bucket no
  longer closes the cell; it stays open with a `placement-cell-coverage`
  finding. Pre-work covering a cell must now also name the cell's package
  through a new optional `PreWorkItem.packageName` field, so unrelated
  pre-work never closes a cell. Existing cells without the new fields join
  exactly as before.

## [0.2.5] - 2026-09-19

### Changed

- Patch version bump only, to obtain a fresh
  `governance/release-qualifications/` record path. The 0.2.4 record was
  introduced in a commit that also changed an unrelated test file; the
  single-introduction-commit invariant refuses that shape, so 0.2.4 cannot
  be published. No functional change from 0.2.4.

## [0.2.4] - 2026-09-19

### Added

- First-wave work items accept optional `act`: `install` (default), `remove`,
  or `relocate`. Pre-work kinds include `remove` and `relocate`, so taking a
  package off a hub or moving it is typed work rather than free-text.
- Optional caller-supplied `placementEvidence` (`schemaVersion` 1) of missing,
  stale, wrong-wiring, over-install, and hub-versus-product cells. Validation
  joins each cell to a matching first-wave act or to `prerequisite` / `remove`
  / `relocate` pre-work. This package still has no filesystem or GitHub I/O;
  a connector fills the JSON from hub-tree observations.

## [0.2.3] - 2026-09-17

### Added

- Declared `foundry.assessment` against the mapped `advisor-check` bin with
  `invocation: "single-json-input"`, so controller onboarding discovers this
  role's first-day assessment surface from the installed manifest instead of
  inferring one.
- Stated the close condition in the README, matching the charter: independent
  consumer evidence shows the owned metric,
  `engagement-decision-currency-rate` as computed by
  `assessEngagementDecisionCurrency()`, meets its setpoint over the declared
  review cadence. This does not claim the position is closed.

## [0.2.2] - 2026-09-16

### Fixed

- A contradicted fit signal collapsed straight to a `violated` verdict with
  no finding naming which criterion was contradicted. `advisor-check` on a
  schema-valid input with one contradicted fit signal returned `state:
  violated`, `firstWavePlan.state: not-recommended`, and an empty
  `findings` array — a sponsor received a blocking "not recommended"
  result with no stated reason. The weaker `unknown` state already emitted
  a named `sponsor-question` finding; `contradicted`, the only other
  negative `SignalState`, emitted nothing. `assessAdvisorEngagement()` now
  emits one `fit-contradicted` finding per contradicted `fitSignals.<id>`,
  naming the criterion, mirroring the shape `sponsor-question` already uses
  for `unknown`.
- Deleted a hand-copied, silently driftable duplicate of `BASIS_FIELDS` (and
  its `equalBasis` helper) from `currency.ts`; it now imports `BASIS_FIELDS`
  and `sameBasis` from `authorization.ts`, the single source this package's
  own README already tells consumers to reuse instead of hand-copying.
  Deleting a field from the private copy previously left every test and gate
  green while `assessEngagementDecisionCurrency()` silently stopped
  comparing that field. `assessment.ts`'s inline basis-digest field list is
  likewise replaced with the exported `BASIS_DIGEST_FIELDS`.
- Documented installation in the README: the public npm registry
  (`https://registry.npmjs.org`) and that no authentication is required.
  Previously the README had no install instructions at all.

## [0.2.1] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `advisor-check` and `advisor-execution-readiness` would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.2.0] - 2026-09-02

### Added

- Export `BASIS_FIELDS` and `BASIS_DIGEST_FIELDS`, the exact field lists an `AssessmentBasis` is built from, so a caller deriving its own current basis from source material can stay bound to this package's own contract instead of a hand-copied field list.
- Export `sameBasis()`, `sameStrings()`, and `packageKey()` — the exact comparison primitives `validateExecutionAuthorization()` is built from — so a caller independently verifying an authorization, a basis, or a package set against its own retained evidence can reuse them instead of re-implementing content-addressed comparison.

## [0.1.6] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.5] - 2026-08-30

### Changed

- Cut a bounded forward patch from unchanged runtime and API source so the
  exact package can be qualified for npm trusted publishing and provenance.

## [0.1.4] - 2026-08-30

### Changed

- Cut a bounded forward patch from unchanged runtime and API source so the
  exact package can be qualified for npm trusted publishing and provenance.

## [0.1.3] - 2026-08-27

### Added

- Add `advisor-execution-readiness`, which re-derives execution readiness at a
  runner-supplied instant and requires exact current authorization before it
  returns ready.

## [0.1.2] - 2026-08-25

### Fixed

- Require every unknown readiness criterion to have matching, owned
  `indeterminate` pre-work; retain the exact `violated` to `unresolved`
  requirement and reject either status mismatch.
- Compare delivery and independent-outcome owner references case-insensitively
  before accepting independent outcome measurement.

## [0.1.1] - 2026-08-24

### Fixed

- Validate a retained execution authorization during recurring assessment and
  command-line evaluation using the same exact-plan, freshness, sponsor, and
  scope contract used for session approval.

## [0.1.0] - 2026-08-24

### Added

- Provider-neutral sponsor fit, readiness, initiative-overlap, and pre-work assessment engine.
- First-wave plans that gate installation on evidenced baseline and conflict clearance.
- Pure session state machine and connector-facing tool contracts and handlers.
- `advisor-check` for JSON assessment reports with three-state exit semantics.
