---
controller: patch
---

`validateInstalledPositionLedger` -- and everything built on it,
`foundry-position-check`, `foundry-completion-evidence-check`, and
onboarding's `authorizeMutation` -- accepts a real 0.9.10 installed-position
ledger again (#1394). Two 0.9.10-valid shapes this package's read side had
stopped accepting are now recognized and reported through a new, non-failing
`InstalledPositionLedgerReport.advisories` field, never through `findings`:
`stageBindings.learnOrEscalate` (renamed `learn` by issue #1194) emits a
`legacy-stage-name` advisory naming the rename; a ledger with no explicit
disposition for `@clossys/customer` (a role this package added in 0.9.11,
after a 0.9.10 ledger was written) emits a `missing-disposition-for-new-role`
advisory naming the role and the version it was introduced in. Both keep
`ok: true` and the same exit code as before -- advisories never change a
verdict, only add information. A ledger using both `learn` and
`learnOrEscalate`, or missing a disposition for a role that already existed
in 0.9.10, still fails exactly as it did before this change.

Breaking: a caller-supplied role or position contract passed as
`foundry-position-check <ledger> [role-contract.json]`'s optional second
argument, or as `validateInstalledPositionLedger`'s `roleContract` argument,
must now equal the contract this version ships -- a 0.9.10 copy of
`role-loop-archetypes.json` is refused with `noncanonical-role-contract`,
the same rule that already refused any other drifted copy. This is not new
in this release; it is a consequence of the shipped contract's own content
changing (the `learn` rename, the added `@clossys/customer` role, and the
Designer/Publisher `boundary.owns` prose reworded in
`controller-designer-publisher-boundary-prose.md`) under the pre-existing
exact-match rule. A consumer who passes this optional argument should drop
it and rely on the contract shipped inside `@clossys/controller`, or replace
their copy with the new one.
