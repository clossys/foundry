---
controller: patch
---

Reword the Designer and Publisher `boundary.owns` prose in
`contracts/role-loop-archetypes.json` (packed content of this package) to
reflect the brand kit and v0 Launch pack ownership split settled with the
five capability maps (#1196/#1204/#1207): Designer owns the image assets
themselves (marks, icons) and the reusable design vocabulary; Publisher
owns the v0 Launch pack's definition, inventory, and readiness, plus the
channel templates that place those assets. The reworded text carries no
issue numbers or emphasis capitals, because Advisor copies it into
client-facing deliverables. No schema or field change, but the shipped
contract text did change: a caller that passes its own copy of the role
contract must now match this reworded text exactly (see this release's
Breaking note).
