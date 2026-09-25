---
launcher: minor
---

`validateAdvisorPlan()` refuses a plan that breaks one of the plan contract's code rules R1-R8, naming the rule and the position of the field at fault, and `planDigest()` throws for such a plan; Launcher implements the rules separately from Advisor, and both are tested against one shared corpus (#1178).
