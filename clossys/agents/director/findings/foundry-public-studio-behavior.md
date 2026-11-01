---
id: foundry-public-studio-behavior
source: https://github.com/clossys/foundry/issues/2553
observed: 2026-11-01
by: Director
aliases: [Studio owner checklist behavior]
---
- Evidence basis: retained previously verified public owner checklist excerpts supplied for this draft; issue updated_at was 2026-11-01T02:20:53Z and observed date was 2026-11-01. This unit did not re-fetch the issue.
- B1: "Every visual piece (frame, section, module content, component, token, asset) is made through the Designer skill and pinned in the consumer library. No page JSX, nothing hand-rolled."
- B2: "Designer items come only from trusted references (shadcn and its registries, Tailark, Dice UI, Magic UI, Fontsource...). Only consumer assets such as a logo may be original. Enforced by provenance check."
- B3: "Publisher only assembles: page = frame + ordered sections + bindings. Visual defects go to Designer, copy to Writer."
- L17: "Pick, never invent… Designer pins only verbatim items from shadcn or adopted registry plus recorded adaptations … anything with no reference becomes a NEED with candidate references … Create happens only when owner asks."
- R5: "REF-VERBATIM: every UI file… reference registry source verbatim except imports, token mapping and data binding; enforced… no hand-rolling."
- Introduction: rows are ticked only after a browser check on the integrated head. F9: initial fill is one candidate per empty IA slot from cleared upstream, followed by user iteration.
- Scope: these excerpts express intended public Studio behavior. Words about enforcement are source wording, not an observation that current gates pass, changes have shipped, or this unpinned draft has owner approval or readiness.
