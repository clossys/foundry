---
launcher: patch
---

`launcher` refuses (exit 1) instead of printing usage (exit 0) when `--inventory`, `--repositories`, `--replace-inventory`, or `--clone-missing` is given in a directory that is not empty, not a git repository, and not an existing hub -- a bare `launcher` there still prints usage, since that is someone finding out what the command does, not a request it cannot satisfy (#1179).
