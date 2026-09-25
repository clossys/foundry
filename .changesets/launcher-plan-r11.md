---
launcher: minor
---

`validateAdvisorPlan()` refuses a plan that staffs a hub-only role (Advisor or Integrator) in any repository, naming rule R11 and the role's position. This includes an existing plan that already staffs `advisor` or `integrator`: Launcher now refuses it, and `planDigest()` throws for it, until the role is removed from its `staffing` (#1178).
