---
slot: "focus.category.definition"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-readonly-bound"]}
feeds: []
functions: ["gtm","product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Category: an open-source, agent-operated design and publishing engine.
- Frame: buyers already know design systems, copy registries and site builders; Foundry joins them behind one CLI that coding agents run.
- Adjacent: AI website builders and hosted design tools, which it is often confused with; Foundry is a set of packages in your repository rather than a hosted editor.

## Because
- Foundry ships MIT-licensed npm packages and a CLI, not a hosted service (finding:foundry-public-repo-facts)
- Studio is read-only inspection, not an editor (finding:foundry-public-studio-readonly-bound)

## Watch
- If public descriptions call Foundry a website builder > 0 times in any release review, then correct the description to this category.
