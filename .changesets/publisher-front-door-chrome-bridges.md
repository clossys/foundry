---
publisher: minor
---

Add deprecated bridge props to `AuthView`, `CaptureView` and `BoundaryView` for hosts that are not yet on `SiteFrame`: an optional `header` and `footer` that replace Designer's `SiteHeader` and `SiteFooter`, and an optional `mainId` that gives the view's own `<main>` that `id` and `tabIndex={-1}` for a skip link in the host's chrome. Passing any of them keeps the previous full page; move to `SiteFrame` instead.
