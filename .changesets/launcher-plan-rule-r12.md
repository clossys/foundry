---
launcher: minor
---

`validateAdvisorPlan()` and `advisorPlanViolations()` refuse a package act whose `planItem` is not its `repository`, a colon and its `name` (rule R12), so `planApplyBundle()` refuses such a plan when it validates the plan (#1550).
