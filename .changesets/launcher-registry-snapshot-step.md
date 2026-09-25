---
launcher: minor
---

New `launcher-apply-plan snapshot --request <file> [--out <file>]` takes the registry snapshot a plan's exact packages are resolved from. It reads the names in `advisor-package-request`'s report, refusing any name outside the publishing scope this package was built with, and writes the snapshot atomically to `clossys/.state/apply/registry-snapshot.json` under the current directory unless `--out` names another file. Exit `0` means the snapshot was written; `2` means nothing was written (#1178).
