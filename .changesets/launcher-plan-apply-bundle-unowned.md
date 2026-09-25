---
launcher: minor
---

`planApplyBundle()` refuses, as `unowned-existing`, any file it would write whole and any `package.json` key it would change that the default branch already has, comparing paths case-insensitively (#1178).
