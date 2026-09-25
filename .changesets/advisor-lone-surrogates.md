---
advisor: minor
---

`validateAdvisorPlan()` and `validateEngagementBrief()` refuse a string or object key that contains a lone surrogate, so every plan that validates has a digest (#1475).
