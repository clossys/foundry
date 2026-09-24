---
controller: patch
---

Breaking: a caller-supplied contract is now refused unless it exactly
matches what this version ships, in three call forms --
`foundry-position-check <ledger> [role-contract.json]`'s optional second
argument; `validateInstalledPositionLedger`'s `roleContract` argument,
which takes a role contract; and the exported
`validateInstalledPositionContract(contract)`, which takes a position
contract. A 0.9.10 copy of either shipped contract --
`role-loop-archetypes.json` or `installed-position-contract.json` -- now
fails with `noncanonical-role-contract` or
`noncanonical-installed-position-contract`, the same exact-match rule that
already refused any other drifted copy; the contracts' own content changed
(the `learn` rename below, the added `@clossys/customer` role, and
reworded Designer/Publisher `boundary.owns` prose). This refusal is new
for every npm consumer, since 0.9.10 is npm's latest published version of
this package. Drop the argument to use the contract shipped inside
`@clossys/controller`, or re-copy it from this version. Everything else
here is backward compatible:
`validateInstalledPositionLedger` -- and everything built on it,
`foundry-position-check`, `foundry-completion-evidence-check`, and
onboarding's `authorizeMutation` -- accepts a real 0.9.10
installed-position ledger again (#1394). `stageBindings.learnOrEscalate`
(renamed `learn` by issue #1194) and a ledger with no explicit disposition
for `@clossys/customer` (a role this package added in 0.9.11, after a
0.9.10 ledger was written) each validate as before, reported through a
new, optional, non-failing `InstalledPositionLedgerReport.advisories`
field -- present whenever there are advisories, defaulting to an empty
array otherwise, and never changing `ok`, `findings`, or exit code.
`foundry-position-check` now also prints these migration advisories, one
`ADVISORY` line per item, to stderr; a passing ledger's stdout is
unchanged, still exactly one `INSTALLED POSITION LEDGER OK` line. A
ledger using both `learn` and `learnOrEscalate`, or missing a disposition
for a role that already existed in 0.9.10, still fails exactly as it did
before this change.
