---
slot: "aspiration.goal.long-term"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-mission","finding:foundry-public-studio-delivery","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["product"]
note: "Alternative human framing of the pinned candidate's direction on the same recorded findings; unpinned draft for owner choice."
vary: {"angle":"human"}
---

## Direction
- Target: an owner can open any L3 slot of all four agents in a consumer workspace and find candidates and one owner pin, with no open value left on a pinned slot.
- Date: 2026-11-06.
- Scope: covers Director, Designer, Writer and Publisher slots in a workspace; excludes adoption counts, revenue and any client work.

## Because
- The slot model gives each slot candidates and at most one pin, so coverage is countable (finding:foundry-public-repo-facts)
- Initial fill comes first, then the user iterates (finding:foundry-public-studio-mission, finding:foundry-public-studio-delivery)
- The owner set the date as the next few days, recorded as 2026-11-06 (finding:foundry-owner-answers-2026-11-03)

## Watch
- If slots without an owner pin > 0 on 2026-11-06, then report those slots to the owner and move the date only with owner words.
