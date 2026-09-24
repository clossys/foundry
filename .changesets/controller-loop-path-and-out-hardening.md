---
controller: patch
---

Loop engine hardening. `isOwnedByRole` treats a backslash as a path
separator, so a Windows-style `..\` segment can no longer escape a role's
own `clossys/<role>/` folder. `planMove` refuses such a source or
destination. `foundry-loop-status` exits 2 with usage and writes nothing
when `--out` is repeated or any `--out` has no path after it.
