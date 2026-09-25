---
launcher: minor
---

`validateApplyBundle()` refuses a bundle in which a repository's verdict is not the worst of its checks, or the authorization-mismatch check is missing or present when it should not be (#1178).
