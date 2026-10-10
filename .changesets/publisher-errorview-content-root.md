---
publisher: minor
---

`ErrorView`, and `AuthView`, `CaptureView`, `BoundaryView` and `DocumentView` when rendered without chrome props inside a `SiteFrame`, now throw when their content root is given a landmark `role` (`main`, `banner`, `contentinfo` or `navigation`) or the `SiteFrame` main `id`, because the frame owns the page's landmarks and its main `id`.
