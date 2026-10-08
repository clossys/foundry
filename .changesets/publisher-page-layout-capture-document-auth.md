---
publisher: minor
---

Give `CaptureView`, `DocumentView` and `AuthView` one shared page layout: the page title as the one `<h1>` with an optional subtitle, the body inside a card, and an optional notes line under the card, centered in one column and rendered without a header, footer or `<main>` of its own. `DocumentView` now renders content only inside a `SiteFrame`, takes `brand` and `footerSecondary` as deprecated optional props for the legacy page, shows its `action` as the notes line, and its column no longer falls back to a fixed `48rem` width when the prose-width token is absent.
