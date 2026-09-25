---
advisor: minor
---

`validateAdvisorPlan()` and `validateEngagementBrief()` refuse an array with holes (one built in code, such as `[a, , b]`; JSON never produces one), reporting it at the array as a sparse array, so no rule ever walks a hole (#1178).
