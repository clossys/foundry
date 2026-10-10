---
publisher: minor
---

`GlobalErrorDocument` now takes `shell`, `resolveCopy` and `resolveAsset` with the `StatusView` props (`status`, `subtitle`, `action`, `notes`) and renders `SiteFrame` around a `StatusView` inside the frame's one `<main>`, while its earlier `ErrorView` props, typed `GlobalErrorDocumentErrorViewProps`, are deprecated and still render the frameless `ErrorView` body for one release.
