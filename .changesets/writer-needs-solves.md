---
writer: minor
---

The `foundry` manifest block now declares `needs` and `solves` (package
framework, #1172). `needs` names Strategist's `brand-derivation` (the voice
record's rules derive from it) and `claims` (live copy cites approved claim
ids). `solves` claims the `writer-unapproved-copy` problem, measured by the
approved copy coverage rate, backed by `copy-coverage` and shown by the
`copy-violated` case. Its evidence is `designed`: no retained qualification
record covers this version yet.
