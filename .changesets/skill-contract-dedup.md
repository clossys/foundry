---
advisor: patch
architect: patch
bouncer: patch
builder: patch
butler: patch
controller: patch
customer: patch
designer: patch
giver: patch
influencer: patch
inspector: patch
integrator: patch
keeper: patch
launcher: patch
locksmith: patch
messenger: patch
observer: patch
publisher: patch
starter: patch
strategist: patch
writer: patch
---

Remove the duplicated `## How we work together` / `## One question at a
time` block from each package's own `skill/SKILL.md`; `@clossys/launcher`
already injects the shared contract from `docs/contracts/conversation-contract.md`
when it composes a skill for a consumer, so the source file no longer needs
to carry a byte-identical copy (#1182). `docs/contracts/conversation-contract.md`
also now names the five loop stages -- `sense`, `judge`, `act`, `verify`,
`learn` -- and the `loop` invocation keyword, matching
`docs/contracts/role-loop-archetypes.json` (#1194).
