---
controller: patch
---

A caller-supplied role or position contract that exactly matches a
previously shipped canonical contract keeps working across an upgrade to
this version, in the same three call forms --
`foundry-position-check <ledger> [role-contract.json]`'s optional second
argument; `validateInstalledPositionLedger`'s `roleContract` argument,
which takes a role contract; and the exported
`validateInstalledPositionContract(contract)`, which takes a position
contract. A caller's exact copy of either shipped contract --
`role-loop-archetypes.json` or `installed-position-contract.json` -- from
a version this package has actually shipped (currently only 0.9.10, npm's
latest published version of this package) is recognized against a small,
explicit, embedded table of historical canonical contracts, keyed by the
version each one shipped in, matched by deep equality, never a loose
comparison. A recognized copy validates against this version's CURRENT
canonical contract and its rules -- already compatible with a 0.9.10
ledger via the advisories below -- and reports a new, non-failing
`legacy-contract-copy` advisory naming the matched shipped version and
suggesting the caller drop the argument or re-copy it from this version;
the same advisory channel used for everything else in this changeset.
Anything that is not an exact match to a known shipped contract --
including a historical copy with even one field changed, such as the
`learn` rename below, the added `@clossys/customer` role, or the reworded
Designer/Publisher `boundary.owns` prose -- still fails with
`noncanonical-role-contract` or `noncanonical-installed-position-contract`,
exactly as the exact-match rule always has. Drop the argument to use the
contract shipped inside `@clossys/controller`, or re-copy it from this
version. Everything else here is backward compatible:
`validateInstalledPositionLedger` -- and everything built on it,
`foundry-position-check`, `foundry-completion-evidence-check`, and
onboarding's `authorizeMutation` -- accepts a real 0.9.10
installed-position ledger again (#1394). In a legacy-format ledger --
precisely, one where no position uses the current `learn` stageBindings
key, and either at least one position uses the pre-rename
`learnOrEscalate` key or the ledger has no positions at all -- two 0.9.10
shapes each validate as before: `stageBindings.learnOrEscalate` (renamed
`learn` by issue #1194), and a missing disposition for `@clossys/customer`
(a role this package added in 0.9.11, after a 0.9.10 ledger was written).
Both are reported through a new, optional, non-failing
`InstalledPositionLedgerReport.advisories` field -- present whenever there
are advisories, defaulting to an empty array otherwise, and never changing
`ok`, `findings`, or exit code. `foundry-position-check` now also prints
these migration advisories, one `ADVISORY` line per item, to stderr; a
passing ledger's stdout is unchanged, still exactly one
`INSTALLED POSITION LEDGER OK` line. A ledger using both `learn` and
`learnOrEscalate` still fails exactly as before; a missing disposition for
a role that already existed in 0.9.10 still fails exactly as before; and a
current-format or mixed-vocabulary ledger (any position uses `learn`)
missing the `@clossys/customer` disposition still fails exactly as it did
on `main` before this change -- the new-role exemption never applies to a
ledger that could not have come from 0.9.10.
