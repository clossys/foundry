---
keeper: patch
---

The held-record hook now ignores a correction or erasure reply from a replaced client, an earlier subject, or a torn-down read, and applies replies to the current client's calls, including calls a child makes from its own effect.
