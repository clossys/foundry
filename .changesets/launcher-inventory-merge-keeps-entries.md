---
launcher: patch
---

When appointing merges an `--inventory` document into a populated stored inventory, every kept entry is written whole, its `packages` included; before, the merged inventory kept only each entry's `id`. The appoint plan carries the merged document as `mergedInventoryDocument` (#1179).
