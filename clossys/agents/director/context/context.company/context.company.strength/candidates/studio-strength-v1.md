---
slot: "context.company.strength"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts"]}
feeds: []
functions: ["tech"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Edge: checks that read what is actually on disk or installed, never what a manifest claims about itself, applied to direction, design, copy and publishing alike.
- Evidence: the README thesis states it, and each agent package ships its own gates (strategist-check, designer token, brand and contrast checks, writer-check).
- Rarity: NEED: no comparison against other tools is recorded; this draft claims the practice, not that nobody else has it.

## Because
- The README thesis and the per-package gates are in the public tree (finding:foundry-public-repo-facts)

## Watch
- If a gate is found passing on a manifest claim rather than on disk state in any audit, then withdraw this Edge until the gate is fixed.
