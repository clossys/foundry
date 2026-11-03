---
id: foundry-public-studio-exclusions
source: https://github.com/clossys/foundry/issues/2553
observed: 2026-11-01
by: director
value: "Public Producer Studio owner requirements for read-only inspection and native authoring ownership"
---

- Public source: Studio acceptance: owner requirements checklist; updated_at: 2026-11-01T02:20:53Z.
- Acceptance rule: "Single checklist of owner requirements for Producer Studio. Every unit PR cites this issue and names the rows it closes. A row is ticked only after the result has been checked in the browser on the integrated head."
- B1: "Every visual piece (frame, section, module content, component, token, asset) is made through the Designer skill and pinned in the consumer library. No page JSX, nothing hand-rolled."
- B3: "Publisher only assembles: page = frame + ordered sections + bindings. Visual defects go to Designer, copy to Writer."
- M4 request-change excerpt: "L3 page = request change (copies prompt)".
- L4: "Read-only: no forms, saves or write endpoints."
- L16 excerpts: "Kill the "Copy link" action on every page"; "remove copy-link action kind".
- Scope: These public requirements support a provisional Studio target draft; they do not establish that the requested behavior has shipped or been approved through browser acceptance.
