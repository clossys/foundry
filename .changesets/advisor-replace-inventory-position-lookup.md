---
advisor: patch
---

The repository-choice skill guidance tells the agent that a `--replace-inventory` run's own success line labels a removed position `repositories[<i>] in the replaced inventory`, the same position it already looked up in the refusal step, so it does not need to look that position up again in the file now on disk (#1179).
