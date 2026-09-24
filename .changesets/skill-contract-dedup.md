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

Remove the duplicated "How we work together" and "One question at a time"
sections from this package's packed skill (`skill/SKILL.md`).
`@clossys/launcher` injects the shared conversation contract when it
composes a skill for a consumer, so the packed skill no longer carries its
own byte-identical copy (#1182).
