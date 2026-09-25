---
launcher: minor
---

`--repositories` never merges into or silently overwrites a stored inventory that lists a different set of repositories: it refuses, stating how many repositories each side has and which ids would be added and removed, unless `--replace-inventory` approves the replacement (#1179).
