---
advisor: minor
---

`validateAdvisorPlan()` refuses a plan that staffs a hub-only role in any repository, with rule `advisor-plan-rule-r11` and the role's position; `planDigest()` throws for such a plan (#1178).
