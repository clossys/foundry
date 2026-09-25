---
advisor: minor
---

New `PUBLIC_PROBLEM_PLACEHOLDER`: the fixed text, read from the brief contract, that Launcher's apply planner will write in place of a brief's `problem` for a repository whose visibility is not private, once that planner is built. Nothing writes it yet: Launcher's brief-only `applyEngagementBrief()` still commits `problem` unchanged (#1178).
