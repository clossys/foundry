---
writer: minor
---

`foundry.capabilities` (schema v3, issue #1196): a MECE capability map of
this role's craft — 8 capabilities `built`: the voice record's own
structural completeness, copy-registry validity, copy coverage (traces
every component string to a registry entry by match or `copy:<id>`
citation — the "approved copy coverage rate" metric, and what
`writer-check`'s default `copy-clean` case actually proves), claims-to-
copy traceability (claim-shaped numeric sentences citing an approved
Strategist claim — whether this stays split from Strategist's own
facts/markers scan is a decision pending #1271), live-copy conformance,
addressability, locale coverage, and voice conformance ("well said",
`voice/checker.ts`); the messaging kit (#1269) is declared `planned`.
Every `built` capability's `proofCase` resolves against this role's own
retained qualification adapter — today one retained case (`copy-clean`),
genuinely proven only for `copy-coverage`, cited as a disclosed anchor
for the rest pending dedicated per-capability cases (#1272). Checked by
`check-capability-maps.mjs` for its own mechanical MECE criteria (no
duplicate outputs or sub-questions within a role, no cross-role output
collision, every capability `inputs` entry resolves) across the five v0
Launch-pack roles — report mode: 0 findings; `--enforce`, with the other
14 roles allowlisted: 0 findings. Whether the declared sub-questions
jointly and completely answer each role's own job question stays a
reviewer judgment, never a mechanical finding.

Minor, not patch: this adds a new declared capability map, a new surface
this role did not previously expose in its manifest.
