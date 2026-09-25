---
launcher: patch
---

`launcher --repositories`'s refusal and success lines name an added or removed repository only by its position (`--repositories[<i>]`, or `repositories[<i>] in the stored inventory`), never by its id, and the same now holds for the `skill roster written` / `skill roster skipped` / `skill preserved` health-report lines and `launcher --clone-missing`'s output (#1179).
