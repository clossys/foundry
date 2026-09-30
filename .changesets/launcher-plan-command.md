---
launcher: minor
---

`launcher-apply-plan plan` computes the apply bundle for the plan file in the hub's working tree and reports on the sheet whether it is the committed one, stores its change sets and the bundle under `clossys/.state/apply/`, and prints an approval sheet of ids and digests only, ending in the `Approve subjectDigest:` line; it takes no approval or binding (#1178).
