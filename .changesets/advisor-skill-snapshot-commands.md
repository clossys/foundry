---
advisor: minor
---

The Advisor skill takes the registry snapshot with exact commands: it saves `advisor-package-request`'s output to a file in a fresh `mktemp -d` directory and prints that file's literal path, runs `launcher-apply-plan snapshot --request <file>`, and stops resolving on exit `2` without using any earlier snapshot. When the installed Launcher has no `snapshot` command, it still skips resolution and says so (#1178).
