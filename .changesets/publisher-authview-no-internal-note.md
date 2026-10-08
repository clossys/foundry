---
publisher: minor
---

Deprecate `AuthView`'s `internalNote` prop: it is still accepted with its `{ label, message }` shape for one release but renders nothing on the frame or the legacy page, so a host drops it and reports a missing sign-in provider setting in its server log instead.
