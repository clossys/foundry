---
publisher: minor
---

`foundry.capabilities` (schema v3, issue #1196): a MECE capability map of
this role's craft — 4 capabilities `built` (surface documents, channel
rendering, the asset roster and coverage from `media/`, and sealing —
which now also absorbs the citation-drift check `checkLedgerDrift`); 7
`partial`: v0 Launch pack planning and inventory (`src/pack/` ships
`validatePackManifest`, `computePackReadiness`/`planPackOrder`/
`sealableItemIds`, and `detectExistingPackItems`/`foundPackItem` as
library functions over `PackManifest`, #1204 — no CLI yet assembles or
checks a real product's `clossys/publisher/pack.json` from them),
templates and channel specs (`src/templates/` now ships
`overviewTemplate.ts`, `deckTemplate.ts`, `emailSignature.ts`, and
`channelSpecs.ts` alongside the earlier web templates, #1207 — nothing
yet assembles them into the declared `templates.json` output), the
materials site (rewritten as an internal, locally opened index per #1206
— `renderMaterialsIndexHtml`, `renderPitchDeckHtml`,
`selectAudienceVariant`, and `materialsPrintStylesheet` ship, but nothing
yet reads a product's own pack manifest to derive the index entries — not
a public site), channel kits, route and visibility governance (reworded
to `visibility: internal | public` per #1204 — `PACK_VISIBILITIES` and
`checkMaterialsVisibility` declare and check visibility at the materials
level, but `checkWebRoutes`/`publisher-web-route-check` still checks only
the route-to-template mapping, no route-level visibility declaration or
refusal yet), the apps/site template (`templates/site/` ships the full
#1208 route set, but is Launcher-applied template content (#1215) outside
this package's own build/typecheck/test, per its own README), and live
parity (now scoped specifically to #1209 — does the live URL match the
sealed record, for public surfaces only per #1206 — backed by
`record/reconciliation.ts`). `proofCase` resolves against this role's own
retained qualification adapter — today one retained case
(`media-satisfied`), genuinely proven only for `asset-roster-and-coverage`,
cited as a disclosed anchor for the rest pending dedicated per-capability
cases (#1272). Checked by `check-capability-maps.mjs` for its own
mechanical MECE criteria (no duplicate outputs or sub-questions within a
role, no cross-role output collision, every capability `inputs` entry
resolves) across the five v0 Launch-pack roles — report mode: 0 findings;
`--enforce`, with the other 14 roles allowlisted: 0 findings. Whether the
declared sub-questions jointly and completely answer each role's own job
question stays a reviewer judgment, never a mechanical finding.

Minor, not patch: this adds a new declared capability map, a new surface
this role did not previously expose in its manifest.
