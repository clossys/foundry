---
publisher: minor
---

Add `SiteFrame`, the page frame that owns the skip link, banner, single `<main>` (fixed id `SITE_MAIN_ID`) and contentinfo, mounted from Designer's chrome using a data-only shell that fails closed on unknown fields, unresolved copy, a non-image brand asset and disallowed links. `siteShellFor(config, kind)` builds that shell for each of the `SITE_SURFACE_KINDS` (`site`, `front-door`, `admin`, `demo`) from one `SiteFrameConfig`, and `SITE_PAGE_LAYERS` publishes the page-assembly contract as frozen data. `AuthView`, `CaptureView` and `BoundaryView` now render landmark-free content for the frame by default; their chrome props are deprecated, optional, and still render the previous page when passed.
