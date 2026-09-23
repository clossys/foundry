# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
