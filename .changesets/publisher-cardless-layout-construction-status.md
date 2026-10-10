---
publisher: minor
---

`@clossys/publisher/web` exports `StatusView`, a whole-page status on a new card-free page layout (the shared title and subtitle header, then an optional call to action and optional notes with no card, and no header, footer or `<main>` of its own), where `status` is the page's one `<h1>` and `subtitle`, `action` and `notes` are optional, so one view serves error, not-found, boundary and placeholder pages; `buildSiteMetadata` accepts a `construction` page kind whose robots value is `noindex, nofollow`.
