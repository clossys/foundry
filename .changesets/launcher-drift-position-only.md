---
launcher: minor
---

`reportInventoryDrift()`'s `externalOnly`, `launcherOnly` and `agreeing` fields are each a count plus every entry's position -- `externalInventory[<i>]` is the declared external document's own `repositories` array index (never a count of the ids kept after skipping a non-object entry or a missing, blank or non-string `id`), and `repositories[<j>]` is the hub's own stored inventory's array index -- instead of the repository ids themselves. The declaration's own `path` is never printed either, even in the `indeterminate` note for a shape launcher has no mapping for or a document that cannot be read (#1179).
