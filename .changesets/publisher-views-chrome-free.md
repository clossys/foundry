---
publisher: minor
---

`AuthView`, `CaptureView` and `BoundaryView` now render their content only, with no header, footer or `<main>`, for use inside a `SiteFrame`; passing any deprecated chrome prop selects the legacy page, which keeps the view's own header, `<main>` and footer around the same content.
