---
advisor: minor
---

New `advisor-package-request <plan.json>` command: prints `packageRequest()`'s result as JSON and exits `0` with the names, `1` for a plan it refuses, and `2` for a usage error or an unreadable file. It reads the plan as strict JSON, and its messages name positions, never plan text or the file's path (#1178).
