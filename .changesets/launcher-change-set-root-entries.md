---
launcher: minor
---

A change set records the Controller repository profile the default branch declares as `observed.repositoryProfile` (its path, whether it has a root vocabulary Controller checks, and the root names the set introduces that it does not declare or prohibits), covered by its digest, and `validateRepositoryChangeSet()` accepts a `declare-root-entry` item that adds each undeclared name to that profile as an allowed extension. It requires the item exactly when the profile needs it, binds it to exactly that profile and those names, and requires a refusal with the new reason `root-vocabulary-unknown` for an unreadable profile, or `unowned-existing` for one that prohibits a name the set introduces (#1178).
