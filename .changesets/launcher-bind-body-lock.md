---
launcher: patch
---

Binding a pull request body to a stored change set now refuses a second bind of the same set that runs at the same time, and a set removed while it is being bound, instead of storing one of two hashes or recreating the set.
