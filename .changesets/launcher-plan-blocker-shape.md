---
launcher: minor
---

`validateAdvisorPlan()` accepts Advisor's blocker shape (`capabilityId`, `kind`, `owner`, `nextAction`, `since`) and a `recommendedNext` without `due`, and refuses the old `description` and `dueDate` blocker fields (#1475).
