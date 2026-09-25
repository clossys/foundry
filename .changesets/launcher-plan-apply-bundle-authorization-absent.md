---
launcher: minor
---

When the plan has package acts and no authorization is passed to `planApplyBundle()`, every computed repository in the bundle carries a violated V3 check with rule `authorization-absent`, so none is reported satisfied (#1178).
