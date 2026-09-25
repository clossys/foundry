---
launcher: minor
---

Launcher compares repository ids one way everywhere: a bare id names a repository of the hub's own owner, and letter case is ignored. A stored inventory, an `--inventory` document, or a `--repositories` choice that lists one repository twice this way, such as `app` and `<owner>/app`, is refused, naming the two positions, instead of being kept as two entries for one repository. `validateInventoryDocument()` and `inspectInventory()` apply that rule when given the hub's owner (`InventoryReadOptions`), and `readInventoryRepositories()` takes it as an optional fourth argument (#1179).
