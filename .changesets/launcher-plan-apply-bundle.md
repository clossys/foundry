---
launcher: minor
---

New `planApplyBundle()` computes one change set per staffed repository in the apply phase, skipping one whose Controller profile needs root entries added (`root-entry-edit-unbuilt`), and a report-mode bundle from a plan, the hub brief and observations of each repository's default branch, and reads no file, network, process or clock (#1178).
