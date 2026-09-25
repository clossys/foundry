---
launcher: minor
---

`planApplyBundle()` writes, for each staffed role whose `SKILL.md` it writes, a discovery link under `.claude/skills` and under `.cursor/skills` (mode `120000`, pointing at the role's composed skill), except under a root the default branch has as a symbolic link; a role whose skill is refused gets no link (#1178).
