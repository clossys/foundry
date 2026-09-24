---
publisher: minor
---

The `foundry` manifest block now declares `capabilities` (manifest schema
version 3, #1196), a capability map of this role's craft with eleven
capabilities: three `built`, two `partial`, and six `planned`. Every
`built` or `partial` capability names as its `proofCase` a
release-qualification case that exercises it (#1272). Built: channel
rendering (`preview-rendered`), the asset roster and coverage
(`media-satisfied`), and sealing and the publication record, which also
covers the citation-drift check `checkLedgerDrift`
(`record-append-only-clean`). Partial: the materials site
(`preview-rendered`), an internal, locally opened index whose renderers
ship but which nothing yet derives from a product's own pack manifest; and
route and visibility governance (`web-routes-clean`), where
`checkMaterialsVisibility` checks visibility for materials but
`publisher-web-route-check` still checks only the route-to-template
mapping. Planned, with no proof case because no qualification case
exercises them yet: surface documents; v0 Launch pack planning and
inventory (`@clossys/publisher/pack` ships `validatePackManifest`,
`computePackReadiness`, `planPackOrder`, and `detectExistingPackItems` as
library functions, but no command checks a real product's pack manifest
with them); templates and channel specs; channel kits; the site template
(shipped under `templates/site/` and applied by Launcher); and live parity.
