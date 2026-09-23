---
designer: minor
---

`foundry.capabilities` (schema v3, issue #1196): a MECE capability map of
this role's craft — 6 capabilities `built` (token contract and
brand-overlay binding, token purity, component conformance, contrast,
type record, and structure/fold conformance including `surface-ladder.ts`);
logo and identity files (#1210) is `partial` — `identity-kit.ts`'s
`generateIdentityDirections` and `adoptSuppliedMark` generate the full
seven-role variant set from tokens or a supplied mark, and
`identity-checks.ts`'s `judgeIdentityKit` checks contrast, minimum size,
clear space, and single-colour legibility against it, but neither path is
yet wired into a checked CLI that produces `clossys/designer/assets/
marks.json` for a real product; brand-kit assembly and general
accessibility (beyond contrast) are `planned` — no code assembles
tokens/type/contrast/marks into one brand-kit record yet. Every
`built`/`partial` capability's `proofCase` resolves against this role's
own retained qualification adapter — today one retained case
(`token-purity-clean`), genuinely proven only for `token-purity`, cited
as a disclosed anchor for the rest pending dedicated per-capability
cases (#1272). Checked by `check-capability-maps.mjs` for its own
mechanical MECE criteria (no duplicate outputs or sub-questions within a
role, no cross-role output collision, every capability `inputs` entry
resolves) across the five v0 Launch-pack roles — report mode: 0 findings;
`--enforce`, with the other 14 roles allowlisted: 0 findings. Whether the
declared sub-questions jointly and completely answer each role's own job
question stays a reviewer judgment, never a mechanical finding.

Minor, not patch: this adds a new declared capability map, a new surface
this role did not previously expose in its manifest.
