# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
