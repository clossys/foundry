---
launcher: minor
---

In the bundle `planApplyBundle()` returns, a repository whose change set changes a lockfile carries V6 `indeterminate` with rule `lockfile-not-run`, because the planner checks the file layout only and does not regenerate the lockfile; V6 is `satisfied` only for a set with no lockfile change (#1178).
