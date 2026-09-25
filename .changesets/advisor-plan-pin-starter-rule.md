---
advisor: minor
---

`validateAdvisorPlan()` refuses a plan with more than one `pin-starter` act for one repository, or a `pin-starter` act whose placement is not `devDependencies` (rule `advisor-plan-rule-r10`, the plan contract's code rule R10) (#1178).
