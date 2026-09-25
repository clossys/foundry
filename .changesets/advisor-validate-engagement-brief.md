---
advisor: minor
---

New `validateEngagementBrief()` validates a brief, including its `context` snapshot, against the shared brief contract `docs/contracts/engagement-brief.json`, and refuses a field that contract does not declare (#1475).
