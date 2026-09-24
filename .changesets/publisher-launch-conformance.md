---
publisher: minor
---

The `foundry` manifest block now declares `outputs`, `feeds`, and `fit`
(package framework, #1172). `outputs` names only the two
`clossys/publisher/` paths this package's own code fixes: `pack.json` (the
Launch pack manifest `@clossys/publisher/pack` validates) and `surfaces/`
(read by the shipped site template, and matching `PUBLISHER_SURFACES_DIR`).
`feeds` hands `surface-documents` to Customer. `fit` names a new shipped
`fit-signals.json` with two signals: an audience-facing surface exists, and
the release must be proved afterwards. `intake` and `status` are not
declared yet.
