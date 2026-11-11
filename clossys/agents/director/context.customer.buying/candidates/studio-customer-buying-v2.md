---
slot: "context.customer.buying"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-owner-answers-2026-11-03","finding:foundry-public-studio-delivery"]}
feeds: []
functions: ["gtm"]
note: "Initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior. v2 (Director re-draft 2026-11-11): Watch rewritten to the by/each/in any window grammar; Direction unchanged."
---

## Direction
- Decider: the engineer or technical founder who owns the repository and approves installing a development dependency.
- Process: read the public README, install the `@clossys` packages from public npm, run the `clossys` CLI against the workspace, then open the localhost Studio to inspect the result.
- Budget: none for the engine, which is free and open under MIT; any paid offering lives outside this public record.

## Because
- The repository is public and MIT licensed, and the packages install from public npm without authentication (finding:foundry-public-repo-facts)
- The owner confirmed the engine is free and open, with paid offerings outside this record (finding:foundry-owner-answers-2026-11-03)
- The Studio preview runs on a local address and is checked in the browser (finding:foundry-public-studio-delivery)

## Watch
- If install steps in the public README > 3 in any release, then propose a shorter install path to the owner.
