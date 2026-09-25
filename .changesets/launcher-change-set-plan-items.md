---
launcher: minor
---

`validateRepositoryChangeSet()` refuses a package item whose `planItem` is not exactly the repository id, a colon and the package name, and a deferral whose `planItem` is not the repository id, a colon and a package name, because a `planItem` is written into the installed-state ledger, which may be public (#1178).
