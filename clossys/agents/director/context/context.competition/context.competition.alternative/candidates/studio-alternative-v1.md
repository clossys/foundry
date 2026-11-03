---
slot: "context.competition.alternative"
source: {"kind":"derived","ref":["finding:foundry-public-studio-readonly-bound","finding:foundry-public-studio-exclusions","finding:foundry-public-studio-essence"]}
feeds: []
functions: ["product","gtm"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Default: doing it by hand: a design tool for visuals, a shared document for copy and hand-written page code, or asking a coding agent to generate pages with no sourced direction.
- Appeal: it is familiar, needs no new records, and an unguided agent produces something on screen quickly.
- Switching: the team must record direction as slots and candidates and route every change through the owning agent instead of editing in place.

## Because
- Studio is read-only, so changes go through Director, Designer, Writer or Publisher rather than inline edits (finding:foundry-public-studio-readonly-bound, finding:foundry-public-studio-exclusions)
- Designer picks from trusted references rather than inventing UI, which unguided generation does not do (finding:foundry-public-studio-essence)

## Watch
- If owner-reported reasons to keep hand edits > 0 in any monthly review, then record each as a finding and revisit this slot.
