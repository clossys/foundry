---
advisor: minor
---

`validateAdvisorPlan()` validates a plan against the shared plan contract `docs/contracts/advisor-plan.json`, and refuses a field that contract does not declare, a blank string, and a time that is not a real calendar time in ISO 8601 form (a date-time needs `Z` or a `±hh:mm` offset), checked field by field so that `2026-02-30` and `T24:30` are refused (#1475).
