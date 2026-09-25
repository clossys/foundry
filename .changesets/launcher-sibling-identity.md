---
launcher: patch
---

Resolving an inventoried repository beside the hub compares owners and the sibling checkout's git origin without regard to letter case, as GitHub does. An id whose owner differed from the hub's only in case was skipped as another account's, and an origin differing only in case was skipped as not matching (#1179).
