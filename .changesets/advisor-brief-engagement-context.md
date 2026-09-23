---
advisor: minor
---

`EngagementBrief` gains an optional `context` snapshot of the engagement context, `toEngagementBrief()` accepts it, and the new `contextFromBrief()` reads it back as a copy with one entry per field, treating an absent snapshot or a missing field as unknown. This is how a role running in a product repository reads what the founder already answered. Because the brief is committed in every staffed repository, `toEngagementBrief()` writes one entry per field id and throws on a duplicate field id or on a known field whose value is not one of that field's fixed choice ids, so founder text, slugified or not, never enters it.
