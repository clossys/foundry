---
starter: minor
---

`prove-head` refuses a head `package-lock.json` entry whose resolved source is not a `https://registry.npmjs.org/` tarball or whose integrity is not one SHA-512 value, other than a bundled dependency recorded with neither field.
