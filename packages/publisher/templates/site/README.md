# apps/site template

Issue #1208: a working marketing site template, wired to a product
repository's own `clossys/` records from the first commit.

**This directory is a template, copied into a consumer repository's
`apps/site` by Launcher (#1215) — it does not run inside Foundry itself.**
Foundry does not install Next.js or React as a dependency, and this
template's own `package.json`/`tsconfig.json` are not part of Foundry's
npm workspace; nothing here is built, typechecked, or tested by this
repository's own `npm run build`/`npm run typecheck`/`npm test`. Treat it
shipped, versioned template content, not compiled source — this
repository's own gitignored `dist/` build output is the only thing
`npm run build`/`npm run typecheck`/`npm test` ever touch.

## What it contains

- `package.json` — Next.js (App Router), `@clossys/publisher/web` and
  `@clossys/designer` as real dependencies once instantiated.
- `next.config.mjs`, `tsconfig.json` — a plain App Router setup.
- `app/layout.tsx` — root layout, renders Designer's theme.
- `app/page.tsx` — the landing route (`MarketingView`).
- `app/about/page.tsx`, `app/contact/page.tsx`, `app/privacy/page.tsx`,
  `app/terms/page.tsx` — the other required routes (#1208's own list),
  each naming a shipped Publisher template.
- `app/not-found.tsx` — 404.
- `app/robots.ts`, `app/sitemap.ts` — Next's metadata route convention.
- `web-route-manifest.json` — the manifest `publisher-web-route-check`
  reads (see `@clossys/publisher/web`'s `evaluateWebRouteManifest`):
  every route above, each naming its template, so CI fails if a route is
  ever added without one or composes Designer blocks directly.
- `vercel.json` — hosting configuration with the application root at
  `apps/site` (#1208's own requirement).

## What every page actually reads

Every page reads copy, tokens, and assets from the repository's own
`clossys/` directory (#1171) at build time, and never copies them into
this template. `app/page.tsx`'s own comment shows the exact read path;
every other route follows the same pattern. This template ships no copy
and no tokens of its own — filling `clossys/` is Advisor's and Strategist's
job (#1176, #1178), not this template's.

## Contact

v0's call to action is a link (`mailto:` or a calendar URL), read from
`clossys/publisher/pack.json`. A real lead-capture path is the next
milestone (#1208's own scope note); this template does not attempt one.

## Not yet wired

Launcher applying this template into a consumer repository's `apps/site`
(#1215) is a follow-up; this directory is the template content only.
