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
the release must be proved afterwards. `intake` and `status` are not
declared yet.

Per-capability proof cases (issue #1272): the qualification adapter gains
record drift, record append-only, web route, preview, and verified
publication rate cases. Every `built` or `partial` capability now cites a
case that exercises it, and no capability cites a stand-in case.

- Sealing and the publication record (`built`) cites
  `record-append-only-clean`.
- Channel rendering (`built`) and the materials site (`partial`) cite
  `preview-rendered`.
- Route and visibility governance (`partial`) cites `web-routes-clean`.
- The asset roster and coverage (`built`) keeps `media-satisfied`.

Six capabilities that no qualification case exercises yet move to
`planned`, with no `proofCase`: surface documents (from `built`), v0 Launch
pack planning and inventory, templates and channel specs, channel kits,
the site template, and live parity (each from `partial`). Their code is
unchanged; each description says what exists today. The map now counts 3
`built`, 2 `partial`, and 6 `planned` capabilities, superseding the counts
given when the capability map was first added.
