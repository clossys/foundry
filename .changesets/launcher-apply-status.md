---
launcher: minor
---

Add `launcher-apply-plan status --repo <id>`, which reports from read-only evidence whether the pull request for a stored change set is proposed, applied, superseded, diverged or indeterminate, checking the pull request's head commit with `verify`'s own checks without fetching or checking it out: its git calls run with lazy fetch off and a time limit, so an object a partial clone lacks, a corrupt object or a hung call is `indeterminate`, never fetched or guessed, and a listing of 100 or more open pull requests is refused. `verify` now reports `removal-present` (exit 1) for a present but unreadable file at a removed path instead of raising (#1178).
