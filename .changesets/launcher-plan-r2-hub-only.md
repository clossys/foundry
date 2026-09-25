---
launcher: minor
---

`validateAdvisorPlan()` no longer requires a hub-only role in `mandate.roles` (Advisor or Integrator, read from the plan contract's `definitions.hubOnlyRoles`) to be staffed in any repository: the plan contract's rule R2 exempts it (#1178).
