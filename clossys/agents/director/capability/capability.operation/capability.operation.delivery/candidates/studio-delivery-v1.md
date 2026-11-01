---
slot: "capability.operation.delivery"
source: {"kind":"derived","ref":["https://github.com/clossys/foundry/issues/2553","finding:foundry-public-studio-delivery"]}
feeds: []
functions: ["ops"]
note: "Intended Studio delivery direction; unpinned draft candidate derived only from the public Studio acceptance checklist."
---

## Direction
- Steps: For Studio initial fill, derive one candidate for each empty IA slot only from cleared upstream input in Director to Designer and Writer to Publisher order; report readiness, then let the user iterate.
- Standard: Clearance precedes derivation; Designer visuals use trusted references, Publisher assembles the frame, ordered sections and bindings, and a row is completed only after browser verification on the integrated Studio head.
- Owner: Director supplies direction; Designer owns visuals; Writer owns copy; Publisher assembles pages from those inputs.

## Because
- Public Studio requirement F9 specifies one candidate per empty IA slot from cleared upstream input, a readiness report, then user iteration (finding:foundry-public-studio-delivery).
- Public Studio requirements B2 and B3 constrain visual sources to trusted references and assign assembly to Publisher, visual defects to Designer and copy to Writer (finding:foundry-public-studio-delivery).
- The public checklist permits a completed row only after checking the result in the browser on the integrated head at the designated Studio preview (finding:foundry-public-studio-delivery).

## Watch
- If unmet upstream clearance requirements > 0 at each derivation attempt, then report the unmet input and hold downstream derivation.
- If unmet render or browser verification requirements > 0 at each readiness report, then report the gap and leave the affected acceptance row incomplete.
