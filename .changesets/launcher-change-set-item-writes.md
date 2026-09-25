---
launcher: minor
---

`validateRepositoryChangeSet()` refuses a change set in which a key, a lockfile invariant, the brief file, a skill file or a refusal does not match the item it names: a package item satisfied in the base that still writes or is refused, one not satisfied that neither writes nor is refused, a key or invariant that is not its item's package, or a refusal naming the ledger item. Items of the acts no package computes yet are not checked against their files (#1178).
