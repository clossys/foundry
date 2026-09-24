---
strategist: patch
---

Correction: the 0.4.0 CHANGELOG entry said the retired `strategy/`
fallback was "scheduled for removal in the next release (0.5.0)". That
removal is deferred — 0.5.0 still reads `strategy/` unchanged, with no
code behavior change from 0.4.0. The runtime notice, README, and packed
skill now say the fallback is still read in this release, with removal
announced beforehand in a later minor release's CHANGELOG.
