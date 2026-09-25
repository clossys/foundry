---
launcher: minor
---

`planApplyBundle()` writes, for each staffed role, a discovery link under `.claude/skills` and under `.cursor/skills` (mode `120000`, pointing at the role's composed skill), except under a root the default branch has as a symbolic link, and writes `clossys/.state/skills.json` listing the skills the set writes, with no time in it. A link path the default branch already has, as a file or a directory, is refused as `unowned-existing` (#1178).
