---
launcher: minor
---

`validateAdvisorPlan()` and `validateEngagementBrief()` validate against the same shared contracts Advisor uses, refuse any field those contracts do not declare, and name every declared field at fault in their reason; a field the contracts do not declare is reported at the object that holds it, by its position there, never by name (#1475).
