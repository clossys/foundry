---
launcher: minor
---

The ids given to `--repositories`, and the document built from them, are checked against the inventory contract before anything is written; a malformed choice is refused by position, without quoting an id, and nothing is written (#1179).
