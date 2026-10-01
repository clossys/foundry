---
writer: patch
---

`resolveFrontDoorCopy()` no longer throws when its copy id is a null-prototype object or any other value that cannot be converted to a string; it reports `"unknown-copy-id"` like any other unknown id. The `types.ts` documentation now states the front-door defaults as the one exemption from the package shipping no real words (#1777).
