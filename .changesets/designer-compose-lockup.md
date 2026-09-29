---
designer: minor
---

`composeLockup`, exported from `@clossys/designer/tokens`, turns a supplied SVG mark, a wordmark string, a font-licence record and a `"mark"` or `"lockup"` header choice into a JSON-serialisable live-text lockup spec, and refuses a non-SVG mark, an empty wordmark or an unrecognised header or licence value with an `IdentityKitValidationError`.
