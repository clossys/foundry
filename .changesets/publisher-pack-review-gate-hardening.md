---
publisher: patch
---

The site template's dev-only pack review now serves `/pack` and `/pack/export` only when `NODE_ENV` is unset, `development` or `test`, so a self-hosted production build answers 404 whatever `SITE_TARGET` says, and every export response carries `x-robots-tag: noindex, nofollow`.
