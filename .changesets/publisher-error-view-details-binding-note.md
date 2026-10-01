---
publisher: patch
---

A stored document that still binds `details` or `detailsLabel` on an error view now fails with `RenderError("resolution-failed")` because those slots no longer exist; remove those bindings.
