---
advisor: minor
---

`validateAdvisorPlan()` refuses a plan that breaks one of the plan contract's code rules R1-R8 -- a repository staffed twice, staffed roles and `mandate.roles` that disagree, a package act for a repository not staffed, a repeated `planItem`, a package twice in one repository, `resolution` without `packages` or the reverse, a repeated kit id, or a role repeated in one staffing entry -- with rule `advisor-plan-rule-r1` to `-r8` and the position of the field at fault; `planDigest()` throws for such a plan (#1178).
