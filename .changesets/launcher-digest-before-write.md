---
launcher: minor
---

`applyEngagementBrief()` computes the plan digest before it writes, and returns a refusal rather than throwing, so a refusal never leaves `clossys/brief.json` behind (#1475).
