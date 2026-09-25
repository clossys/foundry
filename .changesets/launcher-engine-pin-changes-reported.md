---
launcher: minor
---

When resume or appoint changes an engine pin in the hub's `package.json`, the run names each change (`engine pins changed in package.json: ...`, `health.enginePins.changed`) and the next step: run the hub's package manager install, then commit `package.json` together with its lockfile.
