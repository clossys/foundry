---
advisor: patch
---

`toEngagementBrief()` reads a context's `schemaVersion`, `fields` and each field's `id`, `state` and `value` once, refuses a `schemaVersion` other than 1, and no longer echoes a rejected field id in its error (#1396). The intake-question-cards contract states the card id slug rule and which gate runs the reused-id check (#1397).
