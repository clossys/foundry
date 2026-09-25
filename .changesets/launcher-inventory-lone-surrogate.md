---
launcher: minor
---

An inventory whose strings hold a lone surrogate is now refused: an escaped one such as `"\ud800"` in a file (for example in a `packages[].name` or `version`, which was accepted before), and a raw one in a string passed to `validateInventoryDocument()`. It has no UTF-8 encoding, as the shared contract checker refuses it everywhere (#1179).
