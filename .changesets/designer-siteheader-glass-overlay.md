---
designer: minor
publisher: patch
---

SiteHeader takes `placement="overlay"` to sit fixed over the first block, transparent at the top of the page and a blurred glass plate once the page scrolls, with `tone` for the ink a light or dark ground needs and `menuOpen` to hold the glass while a menu is open.
Add the brandable `--color-surface-glass`, `--color-surface-glass-inverse` and `--blur-glass` tokens, all three required brand slots; the brand template lists the two glass colours in every theme block and the blur in the light block.
Upgrading has three visible effects on an existing site: `designer-brand-check` and `publisher-preview` exit 1 on a brand file until it declares all three new slots, and `designer-contrast-check` exits 2 (`unresolvable-token`) on a consumer `tokens.css` that does not declare the two glass colours.
The contrast gate checks primary and on-inverse ink over each glass composited on white and on black, taking the lower of a linear-light blend and the gamma-encoded sRGB blend browsers paint; a pair's `compositeOver` may now be a literal opaque colour, and a translucent or malformed literal is reported unchecked.
Publisher's preview stylesheet carries the overlay header rule.
