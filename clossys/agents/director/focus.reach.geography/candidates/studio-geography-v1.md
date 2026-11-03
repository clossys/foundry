---
slot: "focus.reach.geography"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts"]}
feeds: []
functions: ["gtm"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Where: online and global, through public npm and the public repository; English first.
- Not-yet: localized documentation or region-specific support; Writer supports locales, but no translated Foundry docs are recorded.
- Why: an open-source package has no sales territory; language is the real limit, so English comes first.

## Because
- Packages are public on npm and the repository is public (finding:foundry-public-repo-facts)
- Writer ships a locale coverage gate (finding:foundry-public-repo-facts)

## Watch
- If owner-reported requests for a non-English locale > 2 in any quarter, then propose a localized docs slot.
