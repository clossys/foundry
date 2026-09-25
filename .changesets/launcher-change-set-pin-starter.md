---
launcher: minor
---

`validateRepositoryChangeSet()` refuses a change set with a `pin-starter` item placed anywhere but `devDependencies`, or with more than one `pin-starter` item (#1178).
