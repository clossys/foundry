---
launcher: minor
---

An inventory document is now read as strict JSON: one that repeats a key in any object, is not valid UTF-8, or starts with a byte order mark is refused as invalid, and a JSON syntax error is reported by position only (#1179).
