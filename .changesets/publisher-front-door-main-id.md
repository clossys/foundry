---
publisher: minor
---

Let `AuthView`, `CaptureView` and `BoundaryView` take an optional `mainId`. When set, the page's `<main>` gets that `id` and `tabIndex={-1}` so a skip link in the host's own chrome can target it. Unset, the markup is unchanged.
