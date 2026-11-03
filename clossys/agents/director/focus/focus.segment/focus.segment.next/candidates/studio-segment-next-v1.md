---
slot: "focus.segment.next"
source: {"kind":"derived","ref":["finding:foundry-public-studio-offer","finding:foundry-public-studio-exclusions"]}
feeds: []
functions: ["gtm"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Who: design and content leads on those teams who review agent output in Studio but do not run the CLI themselves.
- Trigger: the core segment pins slots through owner review and asks for others to inspect lineage and history without a terminal.
- Change: Studio must explain each slot and its candidates in plain language, while staying read-only rather than adding edit forms.

## Because
- Studio shows lineage, history and uses on each L3 detail page (finding:foundry-public-studio-offer)
- Change requests copy a prompt to the owning agent (finding:foundry-public-studio-exclusions)

## Watch
- If non-CLI reviewers using Studio rises above 0 in any owner report, then draft a v2 of this slot with their needs.
