---
launcher: minor
---

A hub store now keeps each change set and bundle under clossys/.state/apply/ by digest, and reads one back only when its recomputed digest matches its name.
