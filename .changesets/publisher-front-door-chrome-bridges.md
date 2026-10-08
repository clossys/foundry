---
publisher: minor
---

Add deprecated chrome props to `AuthView`, `CaptureView` and `BoundaryView` for hosts not yet on `SiteFrame`: `header` and `footer` replace Designer's `SiteHeader` and `SiteFooter`, a non-empty `mainId` gives the view's `<main>` that `id` and `tabIndex={-1}` as a skip-link target, and `nav`, `headerAction`, a secondary header action (`headerSecondaryAction`, or `secondaryAction` on `BoundaryView`) and `ground` pass through to the header and footer.
