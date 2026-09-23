---
writer: minor
---

Manifest: `foundry` now declares `outputs` (the copy registry and voice
record under `clossys/writer/`), `feeds` (the copy registry, for
Publisher), `needs` (Strategist's `brand-derivation` and `claims`), `fit`
(a new shipped `fit-signals.json`: the repository ships audience-facing
copy), and `solves` (`writer-unapproved-copy`, proved by `copy-violated`).
`intake` and `status` are not declared yet. Each capability in the map now
cites its own qualification case instead of the shared `copy-clean`
anchor (#1272): `copy-registry`, `addressability` and `locale-coverage`
stay `built`; `voice-record`, `claims-to-copy-traceability`,
`live-copy-conformance` and `voice-conformance` drop to `partial`, because
their case reaches only part of what the capability promises through the
CLI. New `planned` capability `privacy-and-terms-placeholders` (#1270,
#1213): placeholder privacy and terms text drafted from Keeper-supplied
facts and labelled as not legal advice pending counsel review.
