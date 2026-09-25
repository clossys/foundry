---
launcher: minor
---

`planApplyBundle()` takes which skill directories are symbolic links on the default branch, and refuses each skill under one as `skills-root-is-link` instead of writing it; `clossys/.state/skills.json` then lists only the skills it writes (#1178).
