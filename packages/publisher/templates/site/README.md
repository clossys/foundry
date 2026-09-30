# apps/site template

Issue #1208: a working marketing site template, wired to a product
repository's own `clossys/` records from the first commit.

**This directory is a template, copied into a consumer repository's
`apps/site` by Launcher (#1215) — it does not run inside Foundry itself.**
Foundry does not install Next.js or React as a dependency, and this
template's own `package.json`/`tsconfig.json` are not part of Foundry's
npm workspace, so the template itself is not built or typechecked, and its
own `npm run build`/`npm run typecheck` are not run here. Treat it as
shipped, versioned template content, not compiled source. Three static
guards do run in Publisher's own test suite:

1. The `@clossys` ranges in `package.json` cover the on-disk package
   versions, `next`, `react` and `react-dom` cover the versions the
   workspace lockfile resolves, and a range in an unrecognised form fails.
2. Every `var(--name)` that the template, Publisher's web views and
   Designer's atoms, blocks and shell reference is declared by the CSS the
   template loads (Designer's token layer through `theme.css`, or the
   template's own CSS), with a pinned exception list for existing
   references outside the template. The check follows the template's CSS
   `@import`s, so a token layer the template does not load fails.
3. Designer's token-purity scan over the template reports no error and
   nothing it could not classify.

These guards are static. They check declared ranges and property names;
they do not check that an install resolves those ranges, that a value
applies at its cascade scope, or that the template builds.

## What it contains

- `package.json` — Next.js (App Router), `@clossys/publisher/web` and
  `@clossys/designer` as real dependencies once instantiated, plus
  `@clossys/writer` (the copy resolver), `@clossys/messenger` and its
  `resend` peer (the contact delivery), plus
  Tailwind (`tailwindcss`, and `@tailwindcss/postcss` for the build) and
  the peers Designer's components need at render time
  (`react-aria-components`, `tailwind-merge`).
- `postcss.config.mjs` — enables the `@tailwindcss/postcss` plugin.
- `next.config.mjs`, `tsconfig.json` — a plain App Router setup.
- `app/globals.css` — the Tailwind path, in file order: the Tailwind
  import (`@import "tailwindcss"`), Designer's theme
  (`@import "@clossys/designer/theme.css"`), the repository's own brand
  file (`@import "../../../clossys/designer/brand.css"`), then `@source`
  lines for the Designer dist
  (`@source "../node_modules/@clossys/designer/dist"`) and the Publisher
  dist (`@source "../node_modules/@clossys/publisher/dist"`). The
  `@source` paths assume `@clossys/designer` and `@clossys/publisher` are
  installed in the template's own `node_modules` (not hoisted); a hoisted
  install needs the paths adjusted.
- `app/layout.tsx` — root layout: sets `data-brand-bound` on `<html>`,
  injects Designer's theme init script into `<head>`, and sets `metadataBase`
  from `NEXT_PUBLIC_SITE_URL` (see "`NEXT_PUBLIC_SITE_URL`" below).
- `app/page.tsx` — the landing route (`LandingView`).
- `app/contact/page.tsx` and `app/contact/contact-form.tsx` — the contact
  route (`ContactView`). The page is a server component holding an inline
  server action; the form is a client module, because `ContactView` is
  interactive and its server-side export is a stub that throws.
- `app/terms/page.tsx`, `app/privacy/page.tsx` — the legal routes
  (`LegalView`), behind the production legal gate.
- `app/about/page.tsx` — the about route (`MarketingView`). It reads the
  brand-facts record for the name and the legal entity and resolves only the
  ids `aboutCopyIds()` lists; it reads no `clossys/publisher/surfaces/`
  record and carries no wording.
- `app/error.tsx` (a client error boundary) and `app/not-found.tsx` — the
  500 and 404 pages, both rendered by `app/site-error-view.tsx` through
  `ErrorView`.
- `app/site-records.ts` — the one file that reads the repository's records.
- `app/site-copy.ts` — the copy ids and the plain copy map the client
  carries; pure and client-safe. `app/site-copy-context.tsx` provides the
  error boundary's copy from the root layout.
- `app/site-wiring.ts` — the pure server wiring (target, delivery choice,
  contact handler, client key, legal gate); `app/site-contact.ts` and
  `app/site-delivery.ts` assemble it.
- `app/robots.ts`, `app/sitemap.ts`, `app/opengraph-image.tsx` — Next's
  metadata route convention, each a thin wrapper over the pure functions in
  `app/site-wiring.ts` and `app/site-copy.ts` (see "Crawlers and the share
  card").
- `web-route-manifest.json` — the manifest `publisher-web-route-check`
  reads (see `@clossys/publisher/web`'s `evaluateWebRouteManifest`):
  every route above, each naming its template, so CI fails if a route is
  added without one or composes Designer blocks directly. `/contact` names
  `ContactView` and its route file `app/contact/page.tsx`; the view itself
  is imported by `app/contact/contact-form.tsx`.
- `vercel.json` — hosting configuration with the application root at
  `apps/site` (#1208's own requirement).
- `app/site-metadata.ts` — pure `toNextMetadata(meta)` and
  `toNextViewport(meta)`, which map the result of Publisher's
  `buildSiteMetadata` onto Next.js `Metadata` and `Viewport`: the title as
  `absolute`, the canonical under `alternates`, robots, Open Graph with its
  image, the Twitter card, `metadataBase` as a URL, and the theme colour in the
  viewport. It imports only types, and no route uses it yet.

## What every page actually reads

Every page reads its records from the repository's own `clossys/`
directory at build time and never copies them into this template. Four
records, and one file, `app/site-records.ts`, reads them:

- `clossys/strategist/brand-facts.json` — the brand name (the wordmark when
  there is one), the registered legal entity, the contact address and the
  taglines. The first tagline's copy id is the landing heading.
- `clossys/writer/copy-registry.json` — every visible word, by copy id. A
  page resolves the ids it needs when it renders; an id that does not
  resolve fails the render instead of showing a blank. The ids are listed in
  `app/site-copy.ts` (`site.landing.*`, `site.about.*`, `site.share-card.*`,
  `site.contact.*`, `site.footer.*`, `site.legal.*`, `site.error.*`), and the
  registry must hold an entry for each. An approved entry resolves on every target; on `production` an entry
  approved only by a delegate is refused, and so is any approval that is
  stale or expired. That refusal comes from the `target` option of Writer's
  resolver, which needs a Writer release that takes it: the range `^0.4.0` in
  `package.json` does not pick up 0.5.x, and the published 0.4.0 ignores the
  option, so until the range moves a delegate-approved entry also resolves on
  `production`.
- `clossys/publisher/legal/terms.json` and `privacy.json` — the two legal
  documents, whose text is copy ids into the same registry.

Tokens come from `clossys/designer/brand.css`, as before. This template
ships no copy and no tokens of its own.

## `NEXT_PUBLIC_SITE_URL`

`NEXT_PUBLIC_SITE_URL` is the site's origin, for example an `https` address
with no path. It is required, and there is no fallback: an absent, blank or
malformed value fails every page and the build (the root layout reads it, so
404 and 500 fail too), and `next dev` needs it set as well. The message
names the variable and never the value. It must be an `http` or `https`
origin exactly as `new URL(value).origin` writes it: no path, no query, no
credentials and no trailing slash, the rule Publisher's `buildSiteMetadata`
applies to `site.origin`. `app/layout.tsx` sets `metadataBase` from it, and
`robots` and `sitemap` build their absolute URLs from it. The variable is read
only through `siteOrigin()` in `app/site-records.ts`.

## `SITE_TARGET`

`SITE_TARGET` names the deployment: `production`, `preview`, `development`
or `test`. For the legal and copy gates an absent value is `production`, the
strictest target; for crawling an absent value is not `production` (see
below), and any other value stops the site from rendering. It decides four
things:

- **Legal documents.** On `production` a document whose status is not
  `counsel-reviewed` refuses to render, so a draft cannot be served there.
  Every other target renders a draft with its draft notice.
- **Copy.** An entry approved by its owner resolves on every target. On
  `production` the Writer resolver also refuses an entry approved only by a
  delegate; a stale or expired approval is refused on every target. The
  `target` option and the delegate refusal on `production` need a Writer
  release that takes the option: the range `^0.4.0` in `package.json` does not
  pick up 0.5.x, and the published 0.4.0 ignores the option.
- **Crawling and the sitemap**, below.
- **Contact delivery**, below.

## Crawlers and the share card

- **`robots`.** Only an explicit `SITE_TARGET=production` allows crawling and
  names `<origin>/sitemap.xml`. Every other target, and an absent
  `SITE_TARGET`, disallows all crawling and names no sitemap. Set it to
  `production` on the production environment, or the site stays uncrawlable. `robots.txt` stops crawling; it does not guarantee that a URL is
  never listed, because a preview address linked from elsewhere can still
  appear in search results.
- **`sitemap`.** On `production` it lists the routes in
  `web-route-manifest.json` under the origin, and nothing else, so a route
  added to the manifest is listed and a route that is not in it never is. A
  route whose template is `LegalView` is listed only when its document's
  status is `counsel-reviewed`, and then carries that document's own
  `lastUpdated` as `lastModified`; a draft is left out, not an error. No
  other route has a `lastModified`, and nothing reads a clock. On every other
  target, and when `SITE_TARGET` is absent, the sitemap is empty.
- **Share card.** `app/opengraph-image.tsx` draws Publisher's `buildShareCard`
  at the size it declares, as a PNG. The name is the brand label from the
  brand-facts record, the tagline is the first tagline's approved copy (the
  landing heading's when the record lists none), and the alternative text is
  the approved copy `site.share-card.alt`. Colours are Designer's default
  roles; the route sets no colour, length or text of its own. A missing copy
  id fails the build.

## Contact delivery

The contact page sends a message through a server action. The action
reads the request's `x-forwarded-for` header, calls one contact handler
(built on first use and kept, so its counts persist), and returns a result
code the form turns into words. If the handler cannot be built the action
returns `unavailable` and logs a code only.

- **Production delivers through Messenger's Resend adapter.** The key is
  `RESEND_API_KEY`, read from the environment on each send by a function the
  adapter calls, never captured when the module loads. It is never in this
  repository: set it in the host's environment.
- **Every other target uses an in-memory stub** and sends nothing. A stub is
  refused on `production`: the template throws if one is selected there, and
  the handler refuses one too. Nothing here wraps a stub, so it stays
  recognisable.
- **The message goes to the contact address in the brand-facts record, from
  that address**, so the sender must be one the provider has verified.
- **The limiter is per instance.** Five submissions per client per ten
  minutes, counted in one server instance's memory. Several instances (or
  serverless invocations) each count on their own, so the effective limit
  multiplies with them. A shared limiter is a change to
  `app/site-wiring.ts`, not a setting.
- **The client key comes from `x-forwarded-for`.** The template reads the
  last address in the header (the one the nearest proxy appended) and keys
  the limiter on a keyed hash of it, so the key never contains the address.
  An IPv6 address is reduced to its /64 prefix first, because one host
  normally holds a whole /64 and would otherwise get a bucket per address;
  ports, brackets, zone ids, letter case and IPv4-mapped forms are folded
  into one key per address. A last hop that is not an address gets no key of
  its own, and joins the one bucket shared with requests that have no
  header. This is only as strong as the proxy in front of the site: behind a
  host that sets or overwrites the header it identifies the client's
  network; with no such proxy a caller can choose its own key and so has no
  limit. The limiter holds at most 10,000 keys. When the store is full it
  drops keys whose windows have all expired, and refuses a new client while
  every stored window is still live. A caller holding a /48 (65,536 /64
  blocks) or a botnet can keep the store full at about 17 valid submissions
  per second, and new visitors are refused for as long as the flood lasts.
  Each key's first submission is delivered, so the same flood also sends up
  to 10,000 real messages per window. This limiter is a courtesy, not a
  defence: the control that holds is a firewall, a WAF or a platform rate
  rule in front of the route.
- **Sends time out after ten seconds.** A provider that does not answer in
  that time ends the request as `unavailable` instead of holding it open.
  The timer does not cancel the request already sent, so a late send can
  still deliver after the visitor was shown a failure.
- **The honeypot is the only bot check.** A submission that fills the hidden
  field is answered as accepted and delivers nothing. There is no CAPTCHA.

## Not yet wired

Launcher applying this template into a consumer repository's `apps/site`
(#1215) is a follow-up; this directory is the template content only.

`app/error.tsx` covers a failure inside a page. A failure in the root layout
itself (for example a missing copy entry the layout needs) is outside it and
shows Next.js's own fallback; a `global-error.tsx` is not part of this
template.
