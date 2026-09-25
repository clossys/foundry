---
launcher: minor
---

`--inventory <path>` and the on-disk `clossys/.state/inventory.json` are now strictly validated against the inventory schema (`schemaVersion: 1`, a `repositories` array of `{ id: <nonempty string> }` entries, no other top-level or per-entry field, no duplicate ids) before either is adopted; a document that merely resembles an inventory is refused, naming the offending field, and nothing is written (#1334).

A stored inventory that fails that validation is reported as `invalid`, with a reason, instead of being silently treated as empty on resume (#1334).
