---
designer: patch
writer: patch
publisher: patch
launcher: patch
---

Fix the remaining #1205 inconsistencies: Designer's and Writer's packed
skills now say they supply the tokens, atoms, blocks, and copy ids a
surface document cites by reference rather than co-authoring it, matching
Publisher's skill. Publisher's surface-ownership module no longer says the
shared consumer layout contract (#1171) has not landed; that contract now
names Publisher as the owner of `clossys/publisher/surfaces`. Launcher's
packed skill catalogue carries a copy of each role's skill, so it is
released alongside the skill edits (#1184).
