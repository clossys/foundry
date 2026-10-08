---
publisher: patch
---

`CaptureView` omits the `secondaryAction` wrapper when it is `null`, an empty string or an empty list, and `BoundaryView` omits the notes block when `notes` is an empty list, an empty string or `false`.
