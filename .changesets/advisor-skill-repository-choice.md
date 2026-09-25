---
advisor: minor
---

The `clossys-advisor` skill says how to choose the hub's repositories: check that `gh` is signed in and, if it is not, say so plainly and stop without ever asking for a token; list the repositories the account and its organizations can see; ask the repository card; check the answer; and record it by proposing `launcher --repositories`, never by writing the inventory file (#1179).
