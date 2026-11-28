---
name: clossys-reviewer
---

# reviewer

A mechanical review that ran no command, met a missing install (exit 127) or printed no verdict is FAIL, never PASS; a red test that also fails alone at the merge base is base-red, not new red.

Every mechanical run waits in the one run queue, installs for active executors first and then by critical path; a wait never gives up, and a newer head cancels the runs of its unit at the older head.
