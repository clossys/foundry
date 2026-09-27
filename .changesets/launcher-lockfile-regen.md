---
launcher: patch
---

Launcher adds an internal lockfile regeneration module for npm and pnpm, run with install scripts off in an environment built from a fixed allow-list, and a checker that compares a regenerated lockfile with each approved package's version and integrity.
