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
installed-position ledger again (#1394). Two 0.9.10 shapes are now
accepted, each reported through a new, optional, non-failing
`InstalledPositionLedgerReport.advisories` field -- present whenever there
are advisories, defaulting to an empty array otherwise, and never changing
`ok`, `findings`, or exit code. A position whose `stageBindings` uses the
pre-rename `learnOrEscalate` key (renamed `learn` by issue #1194) instead
of `learn` is now accepted in any ledger, current-format or legacy,
including a mixed ledger where other positions already use `learn`; it
reports a `legacy-stage-name` advisory instead of failing. Separately, and
only in a legacy-format ledger -- precisely, one where no position uses
the current `learn` stageBindings key, and either at least one position
uses the pre-rename `learnOrEscalate` key or the ledger has no positions
at all -- a missing disposition for `@clossys/customer` (a role this
package added in 0.9.11, after a 0.9.10 ledger was written) now validates
as before, reporting a `missing-disposition-for-new-role` advisory instead
of failing. `foundry-position-check` now also prints these migration
advisories, one `ADVISORY` line per item, to stderr; a passing ledger's
stdout is unchanged, still exactly one `INSTALLED POSITION LEDGER OK`
line. A position whose `stageBindings` carries both `learn` and
`learnOrEscalate`, or neither, still fails with `invalid-stage-bindings`
exactly as before; a missing disposition for a role that already existed
in 0.9.10 still fails exactly as before; and the `@clossys/customer`
exemption above never extends past a legacy-format ledger -- a
current-format or mixed-vocabulary ledger (any position uses `learn`)
missing that disposition still fails with `missing-role-disposition`
exactly as it did on `main` before this change, even when every other
position in it uses the now-accepted legacy `learnOrEscalate` shape -- the
new-role exemption never applies to a ledger that could not have come
from 0.9.10.
