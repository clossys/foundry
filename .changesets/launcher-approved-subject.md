---
launcher: minor
---

`approvedSubject(plan)` is added: it returns the `subjectDigest` of the latest approving decision, or `null` when that approval has no `subjectDigest`, when decisions at the latest instant disagree or name different subjects, or when any decision time does not parse (#1178).
