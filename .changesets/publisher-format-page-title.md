---
publisher: minor
---

`@clossys/publisher/web` now exports `formatPageTitle({ page, brand })`, which builds the same `<Page> · <Brand>` title `buildSiteMetadata` uses for non-home pages, so sign-in, admin and error pages can share one title pattern.
