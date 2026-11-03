---
slot: "aspiration.goal.long-term"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-mission","finding:foundry-public-studio-delivery"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Target: every L3 slot of all four agents holds at least one candidate and one owner pin for a consumer workspace, with no NEED left on a pinned slot.
- Date: NEED: the owner sets the due date.
- Scope: covers Director, Designer, Writer and Publisher slots in a workspace; excludes adoption counts, revenue and any client work.

## Because
- The slot model gives each slot candidates and at most one pin, so coverage is countable (finding:foundry-public-repo-facts)
- Initial fill comes first, then the user iterates (finding:foundry-public-studio-mission, finding:foundry-public-studio-delivery)

## Watch
- If pinned slots carrying a NEED line > 0 at any readiness report, then unpin nothing but report those slots to the owner.
