---
starter: minor
---

After `npm ci` completes, it compares npm's own hidden lockfile, `node_modules/.package-lock.json`, against the head's `package-lock.json` entry by entry, reporting a mismatch as a violation and an unreadable hidden lockfile as indeterminate.
