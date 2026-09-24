---
controller: patch
---

Fix four loop-engine correctness bugs found in review (#1258): `planMove`
now refuses a source path outside the role's own folder, not only the
destination (a move could otherwise take another role's artifact);
`isBlockerOverdue` treats a date-only `byWhen` as due at the end of that
day, not its first instant (a blocker was reported overdue for the rest of
its own due day); the `foundry-loop-status` CLI now rejects `--out` with no
path following it instead of silently printing to stdout and exiting 0; and
`validateLoopState` now checks that a blocker's `capabilityId` names its
own parent capability and that its `owner` matches `BLOCKER_OWNERS` for its
`kind`, so a hand-edited `loop.json` can no longer record a blocker under
the wrong capability or with the wrong owner. Also fixes onboarding
discovery's `isSafeRelativePath`, which now rejects a `..` segment written
with a `\` separator and a Windows drive-rooted or `\`-led path, closing a
package- and role-folder escape on Windows.
