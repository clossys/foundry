---
launcher: minor
---

A change set's `observed` records whether the default branch has a workflow of its own (`consumerCi`) and which of `.claude/skills` and `.cursor/skills` is a symbolic link there (`symlinkedSkillRoots`), both covered by its digest; `RepositoryObservation` requires both (#1178).
