---
publisher: minor
---

`@clossys/publisher/web` exports `ConstructionView`, for a linked page that is not built yet, and `StatusView`, for a whole-page status such as not found or a server error; both render the card-free page layout (the shared title and subtitle header, then one call to action and optional notes with no card) without a header, footer or `<main>` of their own, and `buildSiteMetadata` accepts a `construction` page kind whose robots value is `noindex, nofollow`.
