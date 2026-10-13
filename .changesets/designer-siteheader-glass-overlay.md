---
designer: minor
publisher: patch
---

SiteHeader takes `placement="overlay"` to sit fixed over the first block, transparent at the top of the page and a blurred glass plate once the page scrolls, with `tone` for light or dark grounds and `menuOpen` to hold the glass while a menu is open.
Add the brandable `--color-surface-glass`, `--color-surface-glass-inverse` and `--blur-glass` tokens; a brand file now needs a value for each of the three to pass the brand coverage check, and the brand template lists the two glass colours in its dark blocks too.
The contrast gate checks primary and on-inverse ink over each glass composited on white and on black, and a pair's `compositeOver` may now be a literal colour.
Publisher's preview stylesheet carries the overlay header rule.
