---
launcher: minor
---

New `ledgerSuccession()` compares a pull request's head ledger with its base's, each given as its exact bytes, under the ledger contract's succession rules. Both must be exactly the bytes the contract renders for them, so a repeated key, a byte order mark or another spelling is refused (`bytes`) and never read as unchanged. The head is either unchanged or exactly one next generation that keeps the base's history, and an admitted generation installs exactly the packages the base's setup set deferred and changes no other row. The result's `admission` is `admitted` only for an admitted generation every rule proved, and `approval-claimed` for an approved head generation, which a reader without the hub cannot authenticate and must not treat as a pass. It checks what the two ledgers claim, not the pull request's files (#1178).
