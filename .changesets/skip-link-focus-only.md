---
designer: patch
---

Activating `SkipLink`, including the one `Shell` renders, now moves focus to its target without updating `location.hash`, adding a history entry or applying `:target` styling, so hash-routed applications keep their current route.
