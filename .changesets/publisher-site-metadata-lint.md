---
publisher: minor
---

Add `lintSiteMetadataHtml` and `SITE_METADATA_REQUIRED_TAGS` to `@clossys/publisher/web`, which report each missing, empty, or duplicated site metadata tag in a rendered document's head in one pass, and report any head content outside a fixed set of head elements, and anything between the closing head tag and the body other than whitespace and comments, as unreadable instead of guessing. `buildSiteMetadata` now also refuses a name, tagline or label that has a tab or other control character inside it.
