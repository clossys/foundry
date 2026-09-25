---
launcher: minor
---

`isPlanApproved()` returns false when any decision's `at` does not parse to a finite time, or when decisions at the same latest instant do not all say `approved`, instead of letting array order decide (#1475).
