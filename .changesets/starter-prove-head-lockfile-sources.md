---
starter: minor
---

`prove-head` refuses a head `package-lock.json` entry whose resolved source is not a `https://registry.npmjs.org/` tarball named for its own entry's name and version, or whose integrity is not one SHA-512 value, other than a bundled dependency recorded with neither field.

It refuses a non-registry dependency spec anywhere one could redirect the install: the manifest's `dependencies`, `devDependencies`, `optionalDependencies`, and `peerDependencies`, `overrides` at any depth, and a lock entry's own dependency maps (or the root entry's `devDependencies`). Accepted forms are a semver version or range, a dist-tag, an `npm:` alias to one, or, inside `overrides`, a `$name` reference.

After `npm ci` completes, it compares npm's own hidden lockfile, `node_modules/.package-lock.json`, against the head's `package-lock.json` entry by entry, reporting a mismatch as a violation and an unreadable hidden lockfile as indeterminate.
