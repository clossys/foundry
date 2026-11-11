---
slot: "context.company.constraint"
source: {"kind":"derived","ref":["finding:foundry-public-studio-readonly-bound"]}
feeds: []
functions: []
note: "Intended Producer Studio interface requirement; runtime enforcement remains unverified. v2 (Director re-draft 2026-11-11): Watch rewritten to the by/each/in any window grammar; Direction unchanged."
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
- If Studio editing affordances, forms, save actions or write endpoints > 0 in any route check, then request correction through the owning agent before treating the read-only requirement as met.
- If Studio routes with uninspected request-change behavior > 0 in any readiness report, then claim no runtime enforcement and request the inspection through the owning agent, preserving the B3 ownership split.
