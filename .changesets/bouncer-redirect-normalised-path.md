---
bouncer: patch
---

`resolveSafeRedirect()` now returns `undefined` for a target carrying a control character or whose normalised path starts with `//` (for example `/.//x` or `/%2e%2e//x`), so a returned redirect can no longer be read as a different host (#1736).
