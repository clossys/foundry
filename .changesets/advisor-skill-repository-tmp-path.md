---
advisor: patch
---

The `clossys-advisor` skill's repository-choice steps now say to echo the temporary directory `mktemp -d` creates and reuse that literal printed path in every later shell call, instead of `$tmp` -- a shell variable does not survive between an agent's separate shell calls, so the earlier wording could send later steps looking for a file at a path that was never actually set (#1179).
