---
publisher: minor
---

`foundry.capabilities` (schema v3, issue #1196): a MECE capability map of
this role's craft — 4 capabilities `built` (surface documents, channel
rendering, the asset roster and coverage from `media/`, and sealing —
which now also absorbs the citation-drift check `checkLedgerDrift`);
5 `partial`: templates and channel specs (only web templates exist;
#1207's email/social/video-call templates and the channel spec registry
don't), the materials site (rewritten as an internal, locally opened
index per #1206 — not a public site), channel kits, route and
visibility governance (reworded to `visibility: internal | public` per
#1204, refusing routes that serve an internal-only item — today
`checkWebRoutes`/`publisher-web-route-check` checks only the
route-to-template mapping, no visibility declaration or refusal yet),
and live parity (now scoped specifically to #1209 — does the live URL
match the sealed record, for public surfaces only per #1206 — backed by
`record/reconciliation.ts`); v0 Launch pack planning and inventory and
the apps/site template (#1208) are `planned`. `proofCase` resolves
against this role's own retained qualification adapter — today one
retained case (`media-satisfied`), genuinely proven only for
`asset-roster-and-coverage`, cited as a disclosed anchor for the rest
pending dedicated per-capability cases (#1272). Drafted per #1202,
checked by `check-capability-maps.mjs` for its own mechanical MECE
criteria (no duplicate outputs or sub-questions within a role, no
cross-role output collision, every capability `inputs` entry resolves)
across the five v0 Launch-pack roles — report mode: 0 findings;
`--enforce`, with the other 14 roles allowlisted: 0 findings (output in
PR #1258). Whether the declared sub-questions jointly and completely
answer each role's own job question stays a reviewer judgment, never a
mechanical finding. Independent review applied: #1258.

Minor, not patch: this adds a new declared capability map, a new surface
this role did not previously expose in its manifest.
