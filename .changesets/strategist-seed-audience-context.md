---
strategist: minor
---

Adds `seedAudienceFromContext` (issue #1173), which proposes a starting `audiences.json` entry from the brief's coarse `audience` field — its `situation` is a neutral sentence built from the choice id, not a copy of Advisor's own card label — and refuses to seed anything once `audiences.json` already has an entry, so a detailed record is never overwritten by a coarse brief guess.
