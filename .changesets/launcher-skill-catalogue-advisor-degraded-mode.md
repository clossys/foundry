---
launcher: minor
---

Launcher's packed skill catalogue carries Advisor's updated `SKILL.md`, which states an explicit degraded mode outside the hub -- a checkout only counts as the hub once its marker validates by `kind`, `schemaVersion` and a git-origin-matched `repository`, every write under `clossys/` is refused outside the hub (not only a decision), and the exact `npx --package=@clossys/advisor@<hub version> <bin>` invocation runs a bin without installing the package (#1507).
