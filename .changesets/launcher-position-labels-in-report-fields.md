---
launcher: patch
---

A caller reading `skillComposition.siblings[].inventoryId` or `reportInventoryDrift()`'s report directly, not only the printed message, gets the same position labels: the report itself carries them, not just its rendering.
