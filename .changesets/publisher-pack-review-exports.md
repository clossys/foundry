---
publisher: patch
---

The site template's dev-only pack review now serves its OG image, notification email and plain-text email at `/pack/export`, refuses to serve on `production` and `preview` hosting even when `SITE_TARGET` is a development value, answers 404 for an unknown `SITE_TARGET`, shows each page's badge beside its forced states and contact-sheet frames, and `PackReviewView` names its sections with `aria-labelledby` and accepts an optional `href` on an export.
