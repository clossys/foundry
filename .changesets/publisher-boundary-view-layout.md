---
publisher: minor
---

`BoundaryView` now renders a page header (`status` as the `<h1>`, `title` as an `<h2>`, then `description`), `action` inside a card and `notes` below it, and no longer renders `ErrorView`, so `className`, `style` and other HTML attributes land on its outer element.
