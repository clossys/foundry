---
launcher: minor
---

`plan` writes a `planned` bundle when the hub's committed plan carries an approval whose bundle the hub holds: each repository's V3 is decided by the admission check, a bound repository with V1 to V9 satisfied is `planned` with its binding, and a stored planned bundle is never replaced by a report of the same digest (#1708).
