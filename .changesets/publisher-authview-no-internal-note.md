---
publisher: minor
---

`AuthView`'s `internalNote` prop is deprecated: it is still accepted with its `{ label, message }` shape for one release and renders nothing, inside a `SiteFrame` or on the legacy page, so remove it from call sites and report a missing sign-in provider setting in the server log instead.
