---
launcher: minor
---

`planApplyBundle()` takes each repository's observed Controller profile. It skips a repository whose profile needs root entries added as `root-entry-edit-unbuilt`, because it does not compute the edited profile's bytes yet, and refuses the declaration as `root-vocabulary-unknown` for an unreadable profile or `root-entry-prohibited` for one that prohibits a root name the set introduces (#1178).
