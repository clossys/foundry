---
launcher: minor
---

`reportInventoryDrift()`'s `externalOnly`, `launcherOnly` and `agreeing` fields are each a count plus every entry's position (`externalInventory[<i>]`, the declared external document's own `repositories` array index, and `repositories[<j>]`, the hub's stored inventory's array index) instead of the repository ids themselves (#1179).
