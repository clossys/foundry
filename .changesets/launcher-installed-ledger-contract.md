---
launcher: minor
---

New `validateInstalledLedger()` validates `clossys/.state/installed.json` against the shared installed-state ledger contract, which this package now packs, including its code rules L1-L8: each generation's change set and approval binding (`approved` by the approved bundle's digest, which may be an earlier run's bundle than the one the set was computed in, or `admitted` right after the approved setup set it names, from the same plan and the same approved bundle), rows that name only the ledger's own generations, owned paths with the right mode for discovery links, keys that match packages, no act recorded twice, and canonical order. Unknown fields are refused and no reason echoes a value. A valid ledger is well formed, not trusted: trusting a row needs the hub's change sets, which this function does not read (#1178).
