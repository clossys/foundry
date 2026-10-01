---
launcher: patch
---

Admission requires the hub branch's upstream to be a remote-tracking ref, so a local branch no longer qualifies, reads the head, its commit and its upstream in one git call, and compares each authorized package by name, version and integrity as one unit, so an entry with an empty name no longer collides with another (#1851).
