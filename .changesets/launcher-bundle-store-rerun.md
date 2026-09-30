---
launcher: patch
---

Running `launcher-apply-plan plan` again on an unchanged hub no longer fails with `store-failed`: the apply-bundle store keeps the newest computation under a bundle digest, replacing that one file atomically when the clock or the committed execution authorization changed (the digest does not cover them), while the change-set store stays append-only (#1178).
