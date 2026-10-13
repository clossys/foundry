---
publisher: minor
---

Render the framed LegalView on the shared page layout: the document title, an optional `summary` subtitle, one card holding both dates and the document body, and the related references as the notes region below it, with every section id and heading kept. The framed page renders no draft or status text and does not resolve the draft heading or facts to confirm, so `labels.draftHeading` is optional there (`LegalViewFramedLabels`). The self-chromed LegalView is unchanged.

Add an explicit `indexing` option (`"index"` or `"noindex"`, legal pages only) to `buildSiteMetadata`. It decides the robots value by itself and makes no counsel-review claim; without it the `status` rule is unchanged. A non-legal page, an unknown value, or `"index"` on a page whose `status` is `"draft"` is refused with the new `invalid-indexing` reason.
