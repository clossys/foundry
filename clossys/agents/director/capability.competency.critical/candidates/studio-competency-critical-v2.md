---
slot: "capability.competency.critical"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-delivery"]}
feeds: []
functions: ["tech","product"]
note: "Initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior. v2 (Director re-draft 2026-11-11): Watch rewritten to the by/each/in any window grammar; Direction unchanged."
---

## Direction
- Capability: checks that read disk state, plus slot contracts precise enough that a coding agent can fill a slot without asking.
- Why: the promise of traced output and the read-only Studio both depend on records an agent can write and a check can verify.
- Bar: `clossys migrate slots --check` passes and every Director slot holds at least one candidate.

## Because
- Each agent ships its own gates and the slot model has a check (finding:foundry-public-repo-facts)
- Initial fill needs a candidate per empty slot (finding:foundry-public-studio-delivery)

## Watch
- If Director slots with zero candidates > 0 in any readiness report, then treat this capability as below the bar.
