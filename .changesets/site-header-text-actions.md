---
designer: minor
publisher: minor
---

Show desktop and menu panel header actions as text only, list the primary action first in the menu panel, and render the mobile header-bar primary as the one ghost icon action. Add `markInk` to `Brandmark` and to the Publisher site brand: `"accent"` paints the mark's shape in the accent token while the wordmark keeps its surface ink token. A `Brandmark` in `SiteHeader`, and so the Publisher site header, now paints its logomark in the accent token by default; pass `markInk="image"` to keep a multi-colour logo, which the accent mask would flatten. A `Brandmark` outside a header keeps the image by default. Keep every brand mark visible in the mobile header, which now hides only the wordmark text, and refresh the compiled and Publisher preview stylesheets for that rule.
