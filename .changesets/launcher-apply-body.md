---
launcher: minor
---

Add `launcher-apply-plan body --repo <id> --task-record <n> [--supersedes <n>]...`, which prints the pull request body for a stored change set and only that, decided from the hub's own approval at the time of the run, and records the SHA-256 of the bytes it printed as the change set's `pullRequest.bodySha256` (a body already bound to another hash is refused as `body-bound`, and a planned bundle holding another approval as `binding-mismatch`). `renderPullRequest` takes an optional `supersedes` list of distinct pull request numbers, written ascending under `## Supersedes`, refused as `supersedes-invalid` otherwise; `body` needs another stored change set of the repository for it (#1178).
