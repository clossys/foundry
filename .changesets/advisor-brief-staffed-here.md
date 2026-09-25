---
advisor: minor
---

`validateEngagementBrief()` accepts an optional `staffedHere` list, and refuses one that names a role not in the brief's `roles` (rule `engagement-brief-rule-b1`) or names a role twice (`engagement-brief-rule-b2`) (#1178).
