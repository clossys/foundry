---
launcher: minor
---

`reportInventoryDrift()` reads the hub's own inventory with `validateInventoryDocument()`; when that inventory is present but invalid the report is `indeterminate`, naming why, instead of comparing the external inventory against an empty list (#1179).
