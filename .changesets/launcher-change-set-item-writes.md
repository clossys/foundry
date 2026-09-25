---
launcher: minor
---

`validateRepositoryChangeSet()` refuses a change set whose keys, lockfile invariants, files or refusals do not match the item they name, including a package item satisfied in the base that still writes, or one not satisfied that neither writes nor is refused (#1178).
