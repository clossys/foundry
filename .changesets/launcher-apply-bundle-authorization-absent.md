---
launcher: minor
---

`validateApplyBundle()` refuses a bundle that records a registry snapshot and no authorization unless every computed repository carries the violated V3 `authorization-absent` check, and refuses that check in any other bundle (#1178).
