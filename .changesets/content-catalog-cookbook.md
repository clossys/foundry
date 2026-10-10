---
publisher: minor
designer: patch
---

`publisher-preview` now also writes `content-catalog.html`, one `LandingView` page that renders each content-section block, specimen arrangement and ground against your `brand.css`, at typical and maximum copy lengths, with a caption in the preview chrome naming each band. Every preview page now links `publisher-preview.css` (generated from the package's new `styles/preview.css`) in place of Designer's `compiled.css`: Tailwind's preflight plus every class Designer's components and Publisher's views use, so band padding, grids and prose styles render as they would in an app's own Tailwind build. Designer ships `CONTENT.md`, a copy cookbook for its content blocks covering block choice, slots, word budgets and page-variety rules, and its skill points to it.
