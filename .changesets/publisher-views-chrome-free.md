---
publisher: minor
---

`AuthView`, `CaptureView` and `BoundaryView` now render landmark-free content for `SiteFrame` when no chrome prop is passed, and render the legacy page, with the view's own header, `<main>` and footer laid out per the shared page layout, when any deprecated chrome prop is passed.
