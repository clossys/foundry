---
launcher: minor
---

`--repositories` never merges into or silently overwrites a stored inventory that lists a different set of repositories: it refuses, stating how many repositories each side has and which ids would be added and removed, unless `--replace-inventory` approves the replacement. A repository that stays keeps its existing entry, `packages` included. An inventory that already lists the chosen repositories is left unchanged, and one that fails its contract is replaced only with `--replace-inventory` (#1179).
