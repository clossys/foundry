---
launcher: minor
---

A declared external inventory that is not valid UTF-8, repeats a key, or starts with a byte order mark is now reported as unreadable (`inventory drift: indeterminate`) instead of being read after silent repair (#1179).
