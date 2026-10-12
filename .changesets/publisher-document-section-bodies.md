---
publisher: minor
---

`renderStructuredDocument` also returns `sectionBodies`: each top-level section's blocks, keyed by section id, without the section wrapper or heading. A view that draws section headings itself (a `LandingView` band's header group) can place a structured document's prose, lists and links in that band's module slot.
