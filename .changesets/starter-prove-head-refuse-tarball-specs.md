---
starter: minor
---

It refuses a dependency spec ending in `.tgz`, `.tar.gz`, or `.tar` anywhere one could redirect the install: the manifest's `dependencies`, `devDependencies`, `optionalDependencies`, and `peerDependencies`, `overrides` at any depth, and a lock entry's own dependency maps (or the root entry's `devDependencies`).
