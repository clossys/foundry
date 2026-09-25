---
advisor: minor
---

New `PUBLIC_PROBLEM_PLACEHOLDER`: the fixed text, read from the brief contract, that Launcher's apply planner, `planApplyBundle()`, puts in place of a brief's `problem` when it computes the brief of a repository whose visibility is not private; the planner writes no file, and Launcher's brief-only `applyEngagementBrief()` still commits `problem` unchanged (#1178).
