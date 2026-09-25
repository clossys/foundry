---
launcher: minor
---

`reportInventoryDrift()` takes the hub's owner as an optional fifth argument and compares ids with the same identity as the rest of Launcher, so an external `app` and the hub's `<owner>/app`, or ids that differ only in letter case, agree instead of appearing on both sides. Every `launcher` run passes the hub's owner (#1179).
