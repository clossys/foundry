---
launcher: minor
---

`reportInventoryDrift()`'s `externalOnly`, `launcherOnly` and `agreeing` fields are each a count plus every entry's position (`externalInventory[<i>]` into the declared external document, or `repositories[<j>]` into the hub's own stored inventory) instead of the repository ids themselves (#1179).
