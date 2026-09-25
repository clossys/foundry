---
advisor: minor
---

`validateAdvisorPlan()` validates a plan against the shared plan contract `docs/contracts/advisor-plan.json`, and refuses a field that contract does not declare, a blank string, and a time that is not ISO 8601 (#1475).
