---
advisor: minor
---

`EngagementBrief` gains an optional `context` snapshot of the engagement context, `toEngagementBrief()` accepts it, and the new `contextFromBrief()` reads it back, treating an absent snapshot as every field unknown. This is how a role running in a product repository reads what the founder already answered.
