---
advisor: patch
---

A sibling hub checkout that validates only through the legacy `.clossys/workspace.json` marker is now told to run `npx @clossys/launcher` once to migrate its marker and inventory in place, instead of being wrongly reported as no hub reachable (#1507).
