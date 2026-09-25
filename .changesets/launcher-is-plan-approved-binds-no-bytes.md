---
launcher: patch
---

The README and the doc comment of `isPlanApproved()` say that it binds no bytes -- it ignores `subjectDigest` -- and that anything that applies a plan must use `approvedSubject()` instead, the one stated exception being the legacy brief-only path, which predates the binding (#1178).
