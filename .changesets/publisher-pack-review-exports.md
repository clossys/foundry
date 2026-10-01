---
publisher: patch
---

`PackReviewView` now names each section with `aria-labelledby`, shows the page badge beside every forced state and contact-sheet frame, separates a frame's page and state with text, and takes an optional `href` on an export so its path links. The site template's dev-only `/pack` review serves every output the pack manifest lists (the OG image, both email forms and the brand-kit favicon, app icon, logo and other files) from a gated `/pack/export` route. It refuses `VERCEL_ENV` `production` and `preview`, a production `NODE_ENV` unless `SITE_TARGET` is `test`, and any `SITE_TARGET` that is not development or test (an unknown one is now a 404, not a 500). It also refuses a symlink that leaves the repository root and marks exports `noindex`.
