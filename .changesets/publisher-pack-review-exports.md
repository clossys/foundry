---
publisher: patch
---

`PackReviewView` now names each section with `aria-labelledby`, shows the page badge beside every forced state and contact-sheet frame, separates a frame's page and state with text, and takes an optional `href` on an export so its path links. The site template's dev-only `/pack` review serves its OG image, notification email and plain-text export from a gated `/pack/export` route, refuses `VERCEL_ENV` `production` and `preview` as well as a `SITE_TARGET` that is not development or test (an unknown `SITE_TARGET` is now a 404, not a 500), and words its copy without placeholders.
