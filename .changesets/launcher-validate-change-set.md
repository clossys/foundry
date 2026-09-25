---
launcher: minor
---

New `validateRepositoryChangeSet()` and `validateApplyBundle()` validate a change set and a bundle against the shared change-set and bundle contracts, which this package now packs, including their code rules, refusing unknown fields and naming positions without echoing values (#1178).
