---
launcher: minor
---

`planApplyBundle()` skips a setup-phase repository as `setup-template-unbuilt`, with verdict `indeterminate`, and leaves it out of the bundle digest, because a setup set must now carry the setup templates, which the planner does not compute yet (#1178).
