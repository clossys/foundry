---
slot: "aspiration.goal.long-term"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-mission","finding:foundry-public-studio-delivery","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior."
---

## Direction
- Target: every L3 slot of all four agents holds at least one candidate and one owner pin for a consumer workspace, with no open value left on a pinned slot.
- Date: 2026-11-06.
- Scope: covers Director, Designer, Writer and Publisher slots in a workspace; excludes adoption counts, revenue and any client work.

## Because
- The slot model gives each slot candidates and at most one pin, so coverage is countable (finding:foundry-public-repo-facts)
- Initial fill comes first, then the user iterates (finding:foundry-public-studio-mission, finding:foundry-public-studio-delivery)
- The owner set the date as the next few days, recorded as 2026-11-06 (finding:foundry-owner-answers-2026-11-03)

## Watch
- If slots without an owner pin > 0 on 2026-11-06, then report those slots to the owner and move the date only with owner words.
