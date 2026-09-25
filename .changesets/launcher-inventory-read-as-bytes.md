---
launcher: minor
---

Every inventory file -- the stored `clossys/.state/inventory.json` on every run, an `--inventory` document, and a declared external inventory -- is now read as its exact bytes and handed to the shared strict reader. Before, it was decoded as text first, which silently replaced bytes that are not valid UTF-8 with U+FFFD, so such a file read as populated and `--replace-inventory` could write the replacement characters back. A stored inventory or `--inventory` document like that is now reported invalid, with the reason `is not valid UTF-8`; a declared external inventory like that makes the drift report indeterminate (#1179).
