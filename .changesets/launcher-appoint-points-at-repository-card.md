---
launcher: minor
---

Appointing a repository with no inventory now tells the founder to choose the hub's repositories on Advisor's repository card and pass them to `launcher --repositories`, instead of pointing at `--inventory <path>`, which still works. On an existing hub, `--inventory` is refused with the same pointer instead of an instruction to edit `clossys/.state/inventory.json` by hand (#1179).
