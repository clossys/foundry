---
advisor: minor
---

`validateAdvisorPlan()` refuses a plan whose `mandate.roles` names one role twice (rule `advisor-plan-rule-r9`, the plan contract's code rule R9), even when the plan has no staffing; such a plan validated before and now has no `planDigest()` (#1178).
