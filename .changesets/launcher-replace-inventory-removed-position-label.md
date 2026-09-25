---
launcher: patch
---

After `--replace-inventory` writes the new file, the success line labels each removed repository's position `repositories[<i>] in the replaced inventory`, distinct from the refusal's `repositories[<i>] in the stored inventory`, since the position indexes into the inventory as it stood before that run (#1179).
