---
slot: "context.company.strength"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["tech"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior."
---

## Direction
- Edge: checks that read what is actually on disk or installed, never what a manifest claims about itself, applied to direction, design, copy and publishing alike.
- Evidence: the README thesis states it, and each agent package ships its own gates (director-check, designer token, brand and contrast checks, writer-check).
- Rarity: this draft claims the practice, not uniqueness (planner default, open to owner change).

## Because
- The README thesis and the per-package gates are in the public tree (finding:foundry-public-repo-facts)
- Rarity follows the planner default recorded with the owner answers (finding:foundry-owner-answers-2026-11-03)

## Watch
- If a gate is found passing on a manifest claim rather than on disk state in any audit, then withdraw this Edge until the gate is fixed.
