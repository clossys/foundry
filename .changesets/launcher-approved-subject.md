---
launcher: minor
---

`approvedSubject(plan)` is added. It returns the `subjectDigest` of the plan's latest decision (by `at`) when that decision chose `"approved"`, and otherwise `null`: when the plan does not validate against the plan contract, when it has no decisions, when its latest decision is not an approval, when that approval has no `subjectDigest`, when decisions tied at the latest instant disagree or name different subjects, or when a decision time does not parse (#1178).
