---
builder: patch
---

`verifyDeployRecord` requires matching `productionCommit`, `builtCommit`, and `publicCommit` SHAs on provider observations, and `@clossys/builder/deployment` adds `planProductionRefUpdate` and `verifyProductionRefUpdate` for fast-forward and merge production-ref advances (#1518).
