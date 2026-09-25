---
launcher: minor
---

`validateAdvisorPlan()` refuses a plan time that is not a real ISO 8601 calendar time, checked field by field, so an out-of-range month, day, hour, minute, second or offset, or a day the month does not have such as `2026-02-30`, is refused (#1475).
