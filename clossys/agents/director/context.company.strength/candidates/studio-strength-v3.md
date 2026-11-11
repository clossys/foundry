---
slot: "context.company.strength"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["tech"]
note: "Initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior. v2 (Director re-draft 2026-11-11): Watch rewritten to the by/each/in any window grammar; Direction unchanged. v3 (Director re-draft 2026-11-11): Watch period set to a calendar window the review loop schedules (in any month); Direction and Because unchanged."
---

## Direction
- Edge: checks that read what is actually on disk or installed, never what a manifest claims about itself, applied to direction, design, copy and publishing alike.
- Evidence: the README thesis states it, and each agent package ships its own gates (director-check, designer token, brand and contrast checks, writer-check).
- Rarity: this draft claims the practice, not uniqueness (planner default, open to owner change).

## Because
- The README thesis and the per-package gates are in the public tree (finding:foundry-public-repo-facts)
- Rarity follows the planner default recorded with the owner answers (finding:foundry-owner-answers-2026-11-03)

## Watch
- If gates found by an audit passing on a manifest claim rather than on disk state > 0 in any month, then withdraw this Edge until the gate is fixed.
