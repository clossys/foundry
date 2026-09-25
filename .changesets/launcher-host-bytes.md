---
launcher: minor
---

`WorkspaceHost` has two new required methods, `readBytes(path)` and `writeBytes(path, contents)`, which read and write a file's exact bytes. A caller that supplies its own host to `planWorkspace()`, `applyWorkspacePlan()` or the other host-taking functions must implement both (#1179).
