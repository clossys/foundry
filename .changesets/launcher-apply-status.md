---
launcher: minor
---

Add `launcher-apply-plan status --repo <id>`, which reports from read-only evidence whether the pull request for a stored change set is proposed, applied, superseded, diverged or indeterminate, checking the pull request's head commit with `verify`'s own checks without fetching or checking it out (#1178).
