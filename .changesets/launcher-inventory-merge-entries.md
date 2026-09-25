---
launcher: patch
---

When appointing merges an `--inventory` document into a populated stored inventory, Launcher now keeps each entry whole, `packages` included, instead of writing ids alone; treats ids that differ only in letter case as one repository, keeping the stored entry; and checks the merged document against the inventory contract before writing it (#1334).
