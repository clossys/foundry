# Site sync

`publisher-site-sync --root <consumer-repository> [--check]` selects the one web
target from `clossys/clossys.config.ts` and uses Publisher's active cell emitter.
It writes App Router entries and app-local source. Check mode writes nothing;
drift or hand edits exit 1, and usage or missing configuration exits 2.

The canonical config's named `siteSyncHost` export supplies the typed
`SiteSyncHost` ports: `frame`, `consent` and `notFound` each name a source `file`
and named `export` already in the selected app-local closure, with optional
finite JSON `props`. `locale` and `security` are explicit. `formSubmit`, when
present, must be a same-origin endpoint; its generated browser submit binding
is `src/clossys/site-sync/form-submit.ts`. Consumers bind that exported callback
to their form host. The command does not invent an endpoint or host lifecycle.

Origin comes from `NEXT_PUBLIC_SITE_URL` or the existing
`clossys/agents/publisher/site-identity.json` canonicalOrigin field. Crawling
is allowed only for `SITE_TARGET=production`. Noindex and external entries do
not create pages; external entries retain their declared redirects. Draft cell
versions remain invisible because the app-local emitter reads active cells.

Host wiring is an explicit input boundary: existing consumer configurations
without `siteSyncHost` need those source ports before this command can write.
The generated redirect array must be imported by the consumer's Next config.
No package manifest, framework config, authored route or hand edit is replaced.
