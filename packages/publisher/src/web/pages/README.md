# Scroll admin page records

The six canonical list/item routes use `composition.binding`. Import their
builders, client copy helpers and `RegisteredRoutePage` from
`@clossys/publisher/web/admin-pages`. This client entry includes the selected
route binder and session helpers without the legacy page barrel. Existing
`@clossys/publisher/web/registered-route` exports remain compatibility APIs;
new adoption uses `web/admin-pages` for its browser imports.

## Prepare Writer envelopes on the server

Import `prepareAdminPageCopyEnvelopes` from
`@clossys/publisher/web/registered-route-check`. Pass
`[{ source, envelope }]` using the actual Writer JSON documents:

- `admin-pages.r1.en.json`
- `admin-studio.r1.en.json`
- `admin-chat.r1.en.json`
- optionally `admin-pages.r1.ar.json`, the two-record Arabic fixture

The server seam calls Writer's public `validateWriterRecord(record, "strings")`.
It preserves authentic optional fields, including absent `limits`, and returns
serializable typed envelopes. It does not approve or activate drafts. The
source filenames must match the external-record declarations in the page
envelope. Missing external sources or cell bindings refuse resolution.

For example, a consumer server loader can validate its three loaded documents
before serializing them to the client:

```ts
import { prepareAdminPageCopyEnvelopes } from
  "@clossys/publisher/web/registered-route-check";

export function preparePageCopy(documents: {
  pages: unknown;
  studio: unknown;
  chat: unknown;
}) {
  return prepareAdminPageCopyEnvelopes([
    { source: "admin-pages.r1.en.json", envelope: documents.pages },
    { source: "admin-studio.r1.en.json", envelope: documents.studio },
    { source: "admin-chat.r1.en.json", envelope: documents.chat },
  ]);
}
```

Pass those envelopes to the client and call
`createAdminPageCopy({ locale: "en", envelopes })`. The returned `copy` function
is the required input to all builders. An arbitrary string callback is refused.
`copy("strings.admin.stats.total", { count: 2 })` uses Writer's ICU resolver.
`copy.resolve({ id, locale?, values? })` also returns the canonical `st.*`
recordId, revision, locale, status, envelope hashes and declared binding cellId
as provenance. Semantic aliases remain the binding cellIds; recordIds address
their Writer records. This is explicit draft-preview resolution, with
activation `none`.

English ICU uses Writer's formatter. The two genuine Arabic literal records
can be addressed with `locale: "ar"`; there is no English fallback. Non-English
ICU and missing/retired records refuse. No second message formatter is supplied.

## Build the six records

`createAdminPageRegistry({ publication, copy, manifests, sources?, itemL0?, itemTitles? })`
returns `{ registry, pages, manifests, publicationHosts, copyProvenance }`.
The individual factories are `createDesignerPageRecords`,
`createWriterPageRecords` and `createPublisherPageRecords`.

`publication` supplies the selected frame, layout, mainSlot and
`context.consumer`. Mount its Designer frame once. Each `pages[kind]` contains
`list`, `item`, `manifest`, `itemManifest`, `query`, `staticContent`,
`createSession` and `copyProvenance`.

Skeletons use
`{ l0: [{ id, label: { id: writerAlias }, count, estimate, partition?, l1: [...] }] }`.
Every L1/L2 label is also an `AdminPageCopyRef`, not a resolved string.
`itemTitles[kind]` (or an individual factory's `itemTitle`) is a Writer ref for
the actual item name. Live item sessions require it. It names the frame trail,
record detail and selected outline entry. `itemL0[kind]` selects the concrete
item's L0 while the route remains `/agents/<kind>/[l0]/[id]`.

Supply the consumer's actual entry/source/runtime modules through `sources`.
Default source identities are examples, not installed modules or qualification
evidence.

In the client runtime, supply the consumer's selected publication and real
manifests, source modules, router navigation and loaders. A list-page setup is:

```ts
import { createAdminPageCopy, createAdminPageRegistry } from
  "@clossys/publisher/web/admin-pages";

const copy = createAdminPageCopy({ locale: "en", envelopes });
const admin = createAdminPageRegistry({
  publication: selectedPublication,
  copy,
  manifests,
  sources,
});
const writer = admin.pages.writer.createSession({
  publication: publicationSession,
  navigation,
  loaders: writerLoaders,
});
```

Here `envelopes` is the server result above. `selectedPublication` and
`publicationSession` describe the same selected, persistent frame. Use
`admin.registry` and routeId `admin.writer` with `RegisteredRoutePage`; supply
the returned `writer` bundle through the selected runtime as described below.
For an item page, build with the current `itemL0` and Writer-ref `itemTitles`,
then pass `item: true` and `itemPath` to `createSession`. Rebuild that binding
when the concrete item parameters or its Writer title change.

## Bind data before it enters the page cache

UI values in loader data use `writerCopy({ id, locale?, values? })`. For example,
a header is `{ text: writerCopy({ id: "strings.admin.page.writer" }), id: "strings" }`.
Rows use Writer refs for displayed names, text, status labels and other UI copy.
Raw display strings refuse. Structural ids, refs, hrefs and numbers remain data;
`adminTechnicalData(kind, value)` explicitly represents supported identifiers,
links, locales, dates or chat-message content. Technical markers cannot replace
a heading or label.

`adminPageRef(kind, name, type?)` constructs
`{ kind: type ?? "records", ref: "admin.<kind>/<name>" }`. Loader content records
carry static refs and `hash: runtimeHash(value)` over their input value:

- `chunk({l0,l1?})` returns an L1 band records ref
  `<l0>/<l1>/band`, whose rows are `{ id: l1, references }`.
  References replace `band.heading`, `band.stats` and `cards`.
- Each cards row is `{ id: l2, references }`, replacing `card.header`,
  `card.rows` and `card.pagination`.
- A card header uses `{ heading: writerCopy(...), level: 4, id, count }`.
  Pagination labels (`showAll`, `label`, `previous`, `next`, `summary`,
  `noResults`) also use Writer refs, including ICU arguments.
- An empty L0 requests `<l0>/empty` with Writer-bound heading/description.
  The selected empty-state uses `kind.empty` and `scope.region`.
- `search(query)` returns `{ l0, anchor | href, label: AdminPageCopyRef, kind }`.
- `item(l0,id)` returns `{ record, content }` or `undefined` for 404.
  Content supplies `item/heading`, `item/stats`, `item/fields`,
  `item/status`, `item/context` and the native item tables.
  Detail fields are `{ label: writerCopy(...), value: writerCopy(...) }`;
  scalar technical field values can remain numbers, booleans or null.

`adminPageContent(copy, reference, value)` is available for synchronous or
already prepared consumer content. It resolves markers and records a matching
content hash. `bindAdminPageLoaders` applies the same boundary to standalone
loader use. Content created with another copy source cannot supply item fields.

## Connect the selected runtime and persistent host

Call `pages[kind].createSession({ publication, navigation, loaders, ... })`,
with `item: true` and a concrete `itemPath` for an item route. The returned
bundle contains:

- `page`: the registered session to pass to the route runtime.
- `resolveContent(reference)`: page data plus synchronous static content.
- `sectionHosts(existing?)`: Writer-backed leaf-specific ports using current
  item fields. Recompute these ports as the page session updates.
- `itemPath` and `copyProvenance()`.

This session helper binds loaders itself. Expose its `resolveContent` through
the runtime's content resolver, retaining the consumer resolver for unrelated
frame references. Static L0 headers, stats, columns and the outline label are
available before any lazy chunk is requested. `partition: "l1"` splits large
L0s per band. Data-table selection and hash navigation remain registered-session
ports.

The section hosts supply `recordDetail` only to record-detail, and
`tableCopy`/`paginationSummary` only to data-table. The detail title and fields
come from the current Writer-bound item. Empty-table copy and the complete
pagination summary come from Writer records.

At the publication host's one-time `bind`, use
`publicationHosts["sections.chat"]` for the shared inspector renderer. It
supplies both root labels and all 19 Chat labels, including code-copy states.
Pages replace inspector context, not the Chat mount or its thread. Missing
required native copy ports refuse; no specimen dataset or English component
defaults are used by these selected renderers.

The consumer still supplies the selected library, manifests, CSS, source
closure, frame adapter and live loader data. Publisher tests use real Writer
records and selected renderers with explicit fixture flow declarations. They
do not qualify a consumer's installed catalog, library refresh, 4503 adoption
or the full A108 landing check.
