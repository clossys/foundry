---
publisher: minor
---

Add `header`, `footer` and `mainId` to `AuthView`, `CaptureView` and `BoundaryView` for hosts not yet on `SiteFrame`: `header` and `footer` replace Designer's `SiteHeader` and `SiteFooter`, and a non-empty `mainId` gives the view's `<main>` that `id` and `tabIndex={-1}` as a skip-link target; `AuthView` and `CaptureView` also take `nav`, `headerAction`, `headerSecondaryAction` and `ground`, which pass through to the header and footer as they already did on `BoundaryView`.
