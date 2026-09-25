---
launcher: minor
---

A change set records which of `.agents`, `.agents/skills` and each role's skill directory is a symbolic link on the default branch as `observed.linkedAgentsPaths`, covered by its digest, and `validateRepositoryChangeSet()` refuses a set that writes a skill under one; such a skill must be refused with the new reason `skills-root-is-link` (#1178).
