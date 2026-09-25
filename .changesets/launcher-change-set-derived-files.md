---
launcher: minor
---

`validateRepositoryChangeSet()` refuses a change set that marks any file derived other than the installed-state ledger and the repository's own lockfile, because a derived file's bytes are outside the change-set digest (#1178).
