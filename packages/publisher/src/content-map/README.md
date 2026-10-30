# Public publication outputs

Import these pure data projections from `@clossys/publisher/content-map`.
The consumer owns one `ContentMap`; the package does not supply site copy,
contacts, origin, crawl permission or a clock.

`ContentMapEntry` keeps its required registered source. `ContentMapNode` also
accepts `ContentMapExternalEntry`: `kind: "external"`, a canonical local `path`
and an HTTP(S) `href`, with no `source`. External entries can be pinned into
navigation, where they carry `external: true` and their destination href.
Groups remain structural and have no navigation href.

Entries may declare `indexing: { mode: "index" | "noindex", reason?: string }`
and an ISO `lastModified` date or zoned timestamp. Indexing defaults to inclusion
when omitted. A noindex page still has a route and static params. This metadata
does not enforce access control or generate a page's head tags.

Pages may declare an ordered `actions` array. Each action supplies `id`, `label`,
an `assets.*` icon, and `defaultOpen`, plus either a `module` with a `sections.*`
`section` and optional nonempty `source` binding, or a host `intent` string.
Intent actions require `defaultOpen: false`. Module references do not register
Sections; the host reports unavailable modules as NEEDs. These page controls
are separate from publication-wide command actions. CELL-P stores them in one
`## Actions` fenced JSON block, after `Manifest` and before `Body` or `Route` when present.

Pages may declare an `ia-scroll` `body` with exact bands
`{ L0: "sections.section-header", L1: "sections.section-header", L2: "sections.cards" }`
and row columns
`["title", "specimen", "status", "version", "usedBy", "linkOut"]`.
Every L2 section uses a cards grid. The superseded `container` field, table
bands, missing L2 bands, and authored row spans are refused.

`row.specimen` may be omitted as an unresolved port or authored as a
`sections.specimen-*` identity. `projectPageBody(map, pageId, specimenId?)`
returns a body for one cell with the exact bound specimen identity and the
same bands and columns. An authored identity must agree with a supplied
identity. Missing bindings, missing page bodies and invalid identity syntax
are refused. The projection resolves only the identity; Designer's consuming
checker still owns specimen registration. CELL-P stores the declaration in
one `## Body` fenced JSON block after `Actions` and before `Route` when present.

Each L3 card contains a header metadata row and the entire bound specimen
body. The H2 renderer owns that anatomy and looks up the specimen leaf by
`row.specimen`. The leaf owns its `full`, `half`, or `third` span; Publisher
does not author, infer, duplicate, or project span metadata. This schema adds
no card payload shape and does not truncate specimen content.

| Function | Output |
| --- | --- |
| `projectRoutes(map, options)` | Registered local page metadata; external entries are excluded. |
| `projectPageBody(map, pageId, specimenId?)` | One cards page body with the exact per-cell specimen identity. |
| `projectSitemap(map, { channel: "site", origin })` | Local indexable page URLs, with optional normalized ISO `lastModified`. |
| `projectStaticParams(map)` | Catch-all `{ slug: string[] }` rows for local pages; the root uses `[]`. |
| `projectRedirects(map)` | Next-compatible `{ source, destination, permanent }` rows. |
| `projectRobots(map, { origin, crawl })` | Crawler rules and the origin's `/sitemap.xml` URL. |
| `buildSecurityTxt({ contact, expires, policy?, preferredLanguages? })` | RFC 9116 field text with a final newline. |

Map `redirects` are explicit `{ from, to, permanent }` declarations. External
entries add permanent redirects from their local path to their external href.
Redirect sources are literal local paths; conflicting sources and local cycles
are refused. Destinations may be canonical local paths with query or fragment,
or explicit HTTP(S) URLs.

`crawl` is explicitly `"allow"` or `"disallow"`. Allow mode lists local pages,
including noindex pages, so crawlers can read their indexing metadata. An allow
list does not deny other URLs. Robots rules are advisory, not access control.

Security contact is one URI or an ordered array of HTTPS, mailto or tel URIs.
Expires is a required RFC 3339 timestamp; the helper validates and serializes
it without making a current-time comparison. Policy, when supplied, is HTTPS.
The host remains responsible for serving the generated protocols at their
standard URLs and choosing an appropriate expiry.

All map projections validate the map before emitting output. Route and static
parameter order follows the existing hierarchy, order and identity sorting;
redirect output is sorted by source. Input arrays and records are not mutated.
