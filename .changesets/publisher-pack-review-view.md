---
publisher: minor
---

`@clossys/publisher/web` exports `PackReviewView`, a dev-only review index that lists a site's pages and their forced states, its exported artifacts and a lazy contact sheet at 390, 1024 and 1440 px, each entry badged `draft`, `delegated` or `approved`, and `@clossys/publisher/pack` exports `buildPackReviewIndex`, which builds those entries from `pack.json` and the site's route list and refuses a manifest, path, route or state it cannot list. The site template adds `/pack`, served only when `SITE_TARGET` is `development` or `test` and answering the 404 page on every other target.
