---
controller: patch
---

Fix four loop-engine correctness bugs found in PR #1258 review: `planMove`
now refuses a source path outside the role's own folder, not only the
destination (a move could otherwise take another role's artifact);
`isBlockerOverdue` treats a date-only `byWhen` as due at the end of that day,
not its first instant (a blocker was reported OVERDUE for the entire rest of
its own due day); the `foundry-loop-status` CLI now rejects `--out` with no
path following it instead of silently printing to stdout and exiting 0;
`validateLoopState` now checks that a blocker's `capabilityId` names its own
parent capability and that its `owner` matches `BLOCKER_OWNERS` for its
`kind`, so a hand-edited `loop.json` can no longer record a blocker under
the wrong capability or with the wrong owner. Also fixes two lower-severity
issues: `isSafeRelativePath` (onboarding discovery) now rejects a `..`
segment written with a `\` separator or a Windows drive-rooted / `\`-led
path, closing a package- and role-folder escape on Windows; and
`docs/contracts/loop.json`'s blocker `owners` vocabulary now matches
`BLOCKER_OWNERS`' own hyphenated strings exactly (the contract previously
used a space-separated form no `Blocker` record ever carries), with
`contract-sync.test.ts` now asserting the full mapping, not only its keys.
