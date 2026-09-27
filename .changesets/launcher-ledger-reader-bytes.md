---
launcher: minor
---

`ledgerSuccession()`, `readInstalledLedger()` and `trustInstalledLedger()` now take the ledger's bytes as a `Uint8Array`, decoded with the same strict reader the plan and brief contracts use, rather than a caller-decoded string.
