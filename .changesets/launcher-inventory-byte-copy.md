---
launcher: patch
---

An inventory Launcher copies rather than composes -- an `--inventory` document when appointing, and a legacy `.clossys/inventory.json` it migrates to `clossys/.state/` -- is written byte for byte, with only a final newline added when one is missing (#1179).
