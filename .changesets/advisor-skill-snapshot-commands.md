---
advisor: minor
---

The Advisor skill takes the registry snapshot with exact commands: it saves `advisor-package-request`'s output to a file in a fresh `mktemp -d` directory and prints that file's literal path, checks with `launcher-apply-plan snapshot --help` that the installed Launcher has the command (skipping resolution and saying so when it does not), runs `launcher-apply-plan snapshot --request <file>`, and stops on exit `2` without using any earlier snapshot. It also stops, saying why, when the temporary directory cannot be made or `advisor-package-request` is not installed (#1178).
