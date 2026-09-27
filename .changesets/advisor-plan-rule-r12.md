---
advisor: minor
---

`validateAdvisorPlan()` refuses a package act whose `planItem` is not its `repository`, a colon and its `name`, with the rule `advisor-plan-rule-r12` at `packages[<i>].planItem`, so such a plan has no digest (#1550).
