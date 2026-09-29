---
publisher: minor
---

Add `buildSiteMetadata` to `@clossys/publisher/web`, which turns a site identity and a page description into one head set (title, canonical, robots, Open Graph, and Twitter card fields) and throws `SiteMetadataError` for an input it cannot build a head from.
