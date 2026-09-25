---
launcher: minor
---

`applyEngagementBrief()` also refuses a plan that does not validate, and its applied result carries the plan's canonical digest, which `launcher-apply-plan` prints (#1475).
