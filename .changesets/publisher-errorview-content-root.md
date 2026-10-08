---
publisher: minor
---

`AuthView`, `CaptureView`, `BoundaryView`, `DocumentView` and `ErrorView` now throw when their content root is given a landmark `role` (`main`, `banner`, `contentinfo` or `navigation`) or the `SiteFrame` main id, because the frame owns those landmarks; `GlobalErrorDocument`, which has no frame and no `<main>`, accepts a landmark `role` on its content root.
