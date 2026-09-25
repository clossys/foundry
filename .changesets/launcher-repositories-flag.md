---
launcher: minor
---

New `--repositories <owner/name>[,<owner/name>...]` writes the repositories a founder chose on Advisor's repository card into `clossys/.state/inventory.json`, when appointing a repository as the hub or on an existing hub (where it is written before skills are composed), so nobody hand-writes the inventory. The chosen ids and the written document are checked against the inventory contract, and a malformed choice is refused by position without writing anything. `planWorkspace()` takes the same choice through `PlanWorkspaceOptions`, and its plan carries a `ChosenInventory` (#1179).
