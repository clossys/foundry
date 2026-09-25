---
launcher: minor
---

When the authorization passed to `planApplyBundle()` names a different plan digest than the plan's, every computed repository in the bundle carries a violated V3 check with rule `authorization-plan-mismatch` (#1178).
