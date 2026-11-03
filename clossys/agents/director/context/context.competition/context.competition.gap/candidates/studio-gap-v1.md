---
slot: "context.competition.gap"
source: {"kind":"derived","ref":["finding:foundry-public-studio-offer","finding:foundry-public-repo-facts"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Gap: no common tool links a brief to the design system, copy and pages built from it, with each piece citing where it came from and which version is pinned.
- Evidence: the public Studio checklist asks for lineage, uses and used-by on every L3 detail page, and the slot model keeps candidates separate from pins.
- Why-open: design, copy and publishing tools each own one layer, and provenance across layers only matters once agents, not people, do the assembly.

## Because
- The requested L3 detail shows references and lineage, checks, contract, history, uses and used-by (finding:foundry-public-studio-offer)
- Each slot holds candidates and at most one pin, which names a sha256 and who pinned it (finding:foundry-public-repo-facts)

## Watch
- If L3 detail pages without lineage > 0 in any Studio release, then report the gap against the checklist rather than claiming it closed.
