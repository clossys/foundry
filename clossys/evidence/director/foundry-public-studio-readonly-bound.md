---
id: foundry-public-studio-readonly-bound
source: https://github.com/clossys/foundry/issues/2553
observed: 2026-11-01
by: director
---
- Retained public owner requirements from foundry#2553, updated 2026-11-01T02:20:53Z, supply this finding; no API reread or runtime inspection was performed for this record.
- L4 states: "Read-only: no forms, saves or write endpoints."
- M4 specifies that the L3 request-change action copies a prompt.
- B3 assigns visuals to Designer, copy to Writer and assembly to Publisher.
- These rows support an intended read-only Producer Studio inspection boundary with changes requested through the owning agent; they do not establish runtime enforcement or broader corporate limits.
- Route evidence and the behavior of editing or write affordances remain unresolved; this finding records requirements, not a verified implementation result.
