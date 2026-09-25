---
launcher: minor
---

`validateAdvisorPlan()` refuses a plan time that is not a real calendar time in ISO 8601 form (a date-time needs `Z` or a `±hh:mm` offset), checked field by field, so an out-of-range month, day, hour, minute, second or offset, or a day the month does not have such as `2026-02-30`, is refused (#1475).
