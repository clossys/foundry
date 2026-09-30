---
publisher: minor
---

The site template's `robots`, `sitemap` and `opengraph-image` routes now read only the declared routes, records and copy ids, with `NEXT_PUBLIC_SITE_URL` as the required origin and crawling allowed only on production, and its `/about` page uses `MarketingView` (#1516).
