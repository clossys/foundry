# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-18

### Added

- `npx @clossys/launcher` as the single get-started command.
- In-package hub skeleton (not a Foundry fork) copied into a GitHub repository.
- Create a new `{owner}/workspace` hub, resume an existing hub, or adopt the current GitHub repository as the account hub.
- Owner inference from `gh` and git remotes, with an interactive picker only when more than one GitHub owner is visible.
- `launcher-check --input` grades a captured observation without creating a hub, so qualification can prove the 0/1/2 ternary.
