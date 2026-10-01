---
publisher: patch
---

`createContactHandler` now reads the delivery's `deliver` and the limiter's `check` once at construction, so a port function reassigned afterwards is not called and a stub assigned onto a production delivery is not reached.
