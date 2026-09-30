---
launcher: minor
---

`launcher-apply-plan plan` computes the apply bundle for the plan committed in the hub, stores its change sets and the bundle under `clossys/.state/apply/`, and prints an approval sheet of ids and digests only, ending in the `Approve subjectDigest:` line; it takes no approval or binding (#1178).
