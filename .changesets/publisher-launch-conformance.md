---
publisher: minor
---

The `foundry` manifest block now declares `outputs`, `fit`, and `feeds`
(package framework, issue #1172). `outputs` names only the two
`clossys/publisher/` paths this package's own code fixes: `pack.json` (the
Launch pack manifest `src/pack/` validates) and `surfaces/` (read by the
shipped site template, and matching `PUBLISHER_SURFACES_DIR`). `feeds`
hands `surface-documents` to Customer. `fit` points at a new shipped
`fit-signals.json` with two signals: an audience-facing surface exists, and
the release must be proved afterwards. `needs`, `solves`, `intake`, and
`status` are not declared yet.

Per-capability proof cases (issue #1272): the qualification adapter gains
record drift, record append-only, web route, preview, and verified
publication rate cases. The capability map now cites them, so the anchor
`media-satisfied` case no longer stands in for capabilities it does not
exercise. Sealing and the publication record cites
`record-append-only-clean`. Channel rendering and the materials site cite
`preview-rendered`, and route and visibility governance cites
`web-routes-clean`. Surface documents drops from `built` to `partial`,
because no bin validates a consumer's own surface documents yet. Five
capabilities still cite the anchor case, as a disclosed placeholder, with
no command to exercise them yet: v0 Launch pack planning, templates and
channel specs, channel kits, the site template, and live parity.
