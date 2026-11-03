---
slot: "execution.measure.north-star"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior."
---

## Direction
- Metric: consumer workspaces fully pinned and published from Foundry, each slot holding a pinned candidate with a traced source.
- Target: 5 workspaces by 2026-12-31; Clossys is the only one named in this public record.
- Why: a pinned, traced slot is direction a team has chosen and an agent can build on, which is the value Foundry promises.

## Because
- Pins and sources are recorded per slot (finding:foundry-public-repo-facts)
- The owner set the target (finding:foundry-owner-answers-2026-11-03)

## Watch
- If fully pinned and published workspaces < 5 on 2026-12-31, then report which workspaces are short and by which slots.
