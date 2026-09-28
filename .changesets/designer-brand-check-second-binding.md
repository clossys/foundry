---
designer: minor
---

`designer-brand-check` now exits 1 when any other `.css`, `.scss` or `.pcss` file under `apps/` (or `--apps <dir>`) declares a `--color-*` property, resets them with `--color-*: initial`, or declares one in `@apply`, so an existing caller that has an `apps/` folder can now fail this check until it keeps one overlay.
