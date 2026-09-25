---
launcher: patch
---

A caller reading `skillComposition.siblings[].inventoryId` or `reportInventoryDrift()`'s report directly, not only the printed message, gets the same position labels: the report itself carries them, not just its rendering. `skillComposition.siblings[].inventoryId` uses the `repositories[<i>] in the stored inventory` label; `reportInventoryDrift()`'s `externalOnly`, `launcherOnly` and `agreeing` positions use the plain `externalInventory[<i>]` / `repositories[<j>]` form instead, never the "in the stored inventory" wording (#1179).
