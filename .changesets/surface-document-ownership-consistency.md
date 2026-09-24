---
designer: patch
writer: patch
publisher: patch
launcher: patch
---

Fix the remaining #1205 inconsistencies: Designer and Writer's skills now
say they supply the tokens, atoms, blocks, and copy ids a surface document
cites by reference rather than co-authoring it, matching Publisher's skill.
The shared consumer layout contract (docs/contracts/consumer-layout.json)
gains the `clossys/publisher/surfaces` entry naming Publisher as owner, and
Publisher's ownership-check module no longer says the contract (#1171) has
not landed. Launcher is bumped alongside the skill edits per #1184.
