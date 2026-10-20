---
designer: patch
---

`Menu.Section` now requires a non-empty `heading` or `aria-label` in its type and throws a `TypeError` at render when neither carries a name, instead of rendering an unnamed menu group.
