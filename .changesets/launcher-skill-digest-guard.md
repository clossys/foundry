---
launcher: minor
---

Before rewriting or retiring a composed skill, Launcher compares its `SKILL.md` with the digest recorded in `clossys/.state/skills.json`, and leaves a file whose content no longer matches that digest as it is instead of overwriting or deleting it (#1473).
