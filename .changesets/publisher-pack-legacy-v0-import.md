---
publisher: minor
---

`@clossys/publisher/pack` adds `importLegacyV0Pack` and `writeLegacyV0PackImport`, which turn an earlier pack index into a `pack.json` that passes `validatePackManifest`, refusing an unknown shape or an unsupported timestamp by path and writing the file only when it does not exist yet.
