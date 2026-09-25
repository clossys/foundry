---
launcher: minor
---

New `ledgerSuccession()` compares a pull request's head ledger with its base's under the ledger contract's succession rules: the head is either unchanged or exactly one next generation that keeps the base's history, and an admitted generation installs exactly the packages the base's setup set deferred and changes no other row. It checks what the two ledgers claim, not the pull request's files (#1178).
