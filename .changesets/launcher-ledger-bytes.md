---
launcher: minor
---

New `serializeInstalledLedger()` returns a valid ledger's exact bytes: every object's members in the ledger contract's declared order, two-space JSON and one line feed. It throws for a ledger the contract refuses (#1178).
