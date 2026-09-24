---
launcher: patch
---

The packed conversation contract now says where a skill's "Where we are"
comes from: the role's status probe summary, and never a hand-written
status file or any other file. If a role has no status probe, or the probe
cannot measure yet, the skill says so plainly.
