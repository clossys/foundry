---
advisor: minor
---

New `advisor-resolve-packages <plan.json> <registry-snapshot.json>` command: prints `resolvePackages()`'s result as JSON and exits `0` when resolved, `1` for a violation, and `2` for an indeterminate result, a usage error or an unreadable file. It reads both files as strict JSON, and its messages name positions, never plan text or a file's path (#1178).
