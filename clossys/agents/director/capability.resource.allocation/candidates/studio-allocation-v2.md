---
slot: "capability.resource.allocation"
source: {"kind":"derived","ref":["finding:foundry-public-studio-delivery","finding:foundry-owner-answers-2026-11-03","execution.priority.bet@1"]}
feeds: []
functions: ["ops"]
note: "Initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior. v2 (Director re-draft 2026-11-11): Because cites execution.priority.bet@1 (Bet-Allocation link); Direction unchanged."
---

## Direction
- Split: 50% engine and Studio, 40% filling and publishing consumer workspaces, 10% docs and release.
- Rule: initial fill of empty slots comes before polish, and Director work comes before Designer and Writer, which come before Publisher.
- Reserve: owner review time for pins, which agents cannot spend.

## Because
- Delivery order is Director to Designer and Writer to Publisher (finding:foundry-public-studio-delivery)
- The owner set the split (finding:foundry-owner-answers-2026-11-03)
- The split serves the current bet, initial fill of every slot before iteration (execution.priority.bet@1)

## Watch
- If downstream work starts with upstream slots at zero candidates > 0 times in any review, then pause it until the upstream fill lands.
