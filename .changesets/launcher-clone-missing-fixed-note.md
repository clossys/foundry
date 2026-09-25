---
launcher: patch
---

`--clone-missing`'s reported note is fixed text (`cloned beside the hub`, or `gh repo clone exited <status>`) instead of the cloned folder name or `gh`'s own stderr, so it no longer repeats the repository id either (#1179).
