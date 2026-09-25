---
launcher: patch
---

The README and the doc comment of `isPlanApproved()` say that it binds no bytes -- it ignores `subjectDigest` -- and that anything that applies a plan must use `approvedSubject()` instead (#1178).
