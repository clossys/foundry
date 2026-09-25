---
launcher: patch
---

When appointing merges an `--inventory` document into a populated stored inventory, an id already present under that identity -- `App` for `app`, or `app` for `<owner>/app` -- is no longer appended as a second entry; the first occurrence is kept, as the merge already did for identical ids (#1179).
