---
slot: "context.customer.buying"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-delivery"]}
feeds: []
functions: ["gtm"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Decider: the engineer or technical founder who owns the repository and approves installing a development dependency.
- Process: read the public README, install the `@clossys` packages from public npm, run the `clossys` CLI against the workspace, then open the localhost Studio to inspect the result.
- Budget: none needed for the engine itself; the packages are MIT licensed. NEED: any paid service around it is out of scope for this public record.

## Because
- The repository is public and MIT licensed, and the packages install from public npm without authentication (finding:foundry-public-repo-facts)
- The Studio preview runs on a local address and is checked in the browser (finding:foundry-public-studio-delivery)

## Watch
- If install steps in the public README > 3 at any release, then propose a shorter install path to the owner.
