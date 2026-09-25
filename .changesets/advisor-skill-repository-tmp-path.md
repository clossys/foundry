---
advisor: patch
---

The `clossys-advisor` skill's repository-choice steps echo the temporary directory `mktemp -d` creates and reuse that literal printed path in every later shell call, rather than the shell variable `$tmp` itself -- each numbered step is its own separate shell call, and a shell variable set in one does not survive into the next (#1179).
