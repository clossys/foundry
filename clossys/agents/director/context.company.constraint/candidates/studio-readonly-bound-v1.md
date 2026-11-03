---
slot: "context.company.constraint"
source: {"kind":"derived","ref":["https://github.com/clossys/foundry/issues/2553","finding:foundry-public-studio-readonly-bound"]}
feeds: []
functions: []
note: "Intended Producer Studio interface requirement; runtime enforcement remains unverified."
---

## Direction
- Limit: Producer Studio inspection is read-only.
- Bound: No forms, saves or write endpoints in Studio.
- Effect: Request changes through the owning agent rather than inline Studio editing; preserve Publisher assembly, Designer visuals and Writer copy.

## Because
- L4 of the public owner requirements in foundry#2553, updated 2026-11-01T02:20:53Z, states: "Read-only: no forms, saves or write endpoints." This bounds the Studio interface (finding:foundry-public-studio-readonly-bound).
- M4 specifies the L3 request-change action copies a prompt; B3 assigns visuals to Designer, copy to Writer and assembly to Publisher. These requirements support routing changes to the owning agent (finding:foundry-public-studio-readonly-bound).
- This candidate records an intended interface constraint; the cited requirements do not verify current runtime behavior or establish broader corporate limits (finding:foundry-public-studio-readonly-bound).

## Watch
- If Studio exposes an editing affordance, form, save action or write endpoint, request correction through its owning agent before treating the read-only requirement as met.
- Route evidence remains unresolved: inspect the relevant Studio routes and request-change behavior before claiming runtime enforcement; preserve the B3 ownership split when requesting changes.
