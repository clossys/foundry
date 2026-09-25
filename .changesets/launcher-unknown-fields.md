---
launcher: minor
---

`validateAdvisorPlan()` and `validateEngagementBrief()` validate against the same shared contracts Advisor uses, refuse any field those contracts do not declare, and name every field at fault in their reason (#1475).
