# Consumer page configurations

The consumer owns page composition as data. Publisher turns checked page
configurations, content-map entries and loader manifests into native
`composition.binding` records. Import `createConsumerPageRegistry`, copy helpers
and `RegisteredRoutePage` from `@clossys/publisher/web/admin-pages`.

There is no three-page kind enum or named Designer/Writer/Publisher page
factory. The admin publication supplies its three configurations in consumer
data; another publication can supply different identities, columns and item
sections. The browser entry contains the existing selected route binder and
session helpers without the retired hand-built page exports.

## Strategy catalogue example

[`strategy-pages.config.json`](../../../examples/strategy-pages.config.json) is
a Foundry package example of a strategy list and cell detail. It uses the existing
consumer configuration path: one selected `frames.app-shell`, native section
headers, bands and table, and a `sections.article` detail inside a prose band.
Its explicit `pageModule: null` makes no Admin table-of-contents claim. The
configuration supplies no named page component or body callback.

The server entry `@clossys/publisher/web/registered-route-check` exports
`prepareStrategyPage`, `prepareStrategyPageRegistry` and their input/result
types. Browser imports of that server entry refuse; the client/admin-pages
entries do not import strategy preparation or the Writer server validator.

`prepareStrategyPage` accepts an injected, synchronous `StrategyPageReader`.
The consumer opens the actual ST2 snapshot with `openStrategy(root, { contracts })`.
The fixture uses the real installed `designer.identity`, `writer.messaging` and
`publisher.launch` contracts. Publisher introduces no Strategist filesystem
runtime dependency. Reopen the handle to observe changed drafts or pointers.
Pass the actual `readStrategyRoot(root).issues` when the host reads a local root;
an unreadable root must not be presented as an empty catalogue.

The result preserves canonical status, findings, L0/L1/L2, counts, next unlock,
storyline `not judged`, and native brief state/fingerprints. Latest file, pointer
version and canonical active/fresh status are distinct. It does not infer MVS or
completion from `status()`. A readable empty root still has catalogue rows. A
selected cell outside the requested scope refuses rather than claiming its
pointer is missing. Synchronous reads introduce no artificial loading lifecycle,
backend search, bulk operation or pagination API.

The owned draft UI envelope is
[`strategy-page.copy.r1.en.json`](../../../examples/strategy-page.copy.r1.en.json).
Fixed labels, status vocabulary and metadata/count templates live there. Template
arguments carry numeric values, resolved Writer vocabulary and technical ids;
strategy prose is never an interpolation argument. Full strategy bullets and
finding messages become proposed `strings.common` draft records through the
existing Writer validation and resolver. The consumer supplies
`recordIdForContext` and its actual `ownedRecords`; there is no Writer mint API.
Ids are stable canonical `st.*` proposals, collision checked against that set,
the UI envelopes and this projection. A known id can be reused only for its exact
owned context/leaf; another owner's record or a UI source cannot be shadowed.
Advance `source.revision` when authoring a
new source envelope. No approval or activation is manufactured.

Each complete bullet keeps its optional `key + ': '`, original text, terminal
citation prose, parsed refs and physical line. Citations are not appended again.
The adapter encodes literal ICU syntax and checks exact resolved-text roundtrips.
The existing `strings.common` bound is 320 Unicode code points and 60 locale
words of display text. Overlimit fields yield source-located, non-renderable
`copy-limit` findings; they are not shortened or divided to fit. Native Writer
WR7/WR8 tests also check the emitted records. Record fields retain Writer's
closed schema; source and copy evidence is separate metadata.

The `status: "prepared"` result describes prepared data. It supplies frozen
`rows`, `body`, `selectedTitle`, a checked
Writer `copy`, its proposed envelope, and source provenance. `cellFingerprint`
hashes the parsed cell; it is not a source-byte hash. Exact transitive source-byte
fingerprints remain the actual native `Brief.fingerprint` values. Provenance
also records source revision, envelope hash, Writer binding/source proof and the
stable snapshot digest.

Store both data snapshots in each proposed canonical route candidate before
creating its immutable Publisher revision:

```ts
const typeSettings = {
  consumerPage: compositionSnapshot,
  strategyPage: page.sourceSnapshot,
};
```

`compositionSnapshot` is the existing `ConsumerPageCompositionSnapshot` with the
consumer's actual publication, map, configuration, manifest and source exports.
The list and detail candidates must own identical composition and strategy source
snapshots. Supply their actual `{ routeId, slotId, candidateId, revision, digest }`
selections:

```ts
const bound = prepareStrategyPageRegistry({ registry, locale: "en", selections, page });
// Existing consumer loaders carry page.rows and page.body through the checked
// copy seam; existing native sessions and runtime ports prepare each route.
const result = prepareConsumerPageRoute(bound, routeId, runtime);
```

The source pins cover the strategy snapshot, exact Writer envelope bytes and
native brief fingerprints. Missing, crossed or stale selections refuse. These
checks bind a package preview; they grant no publication approval or consumer
adoption.

### Reproduce the native list and detail proof

After cloud bootstrap/check, build Strategist declarations before the repository
build (Writer's new strategy contract types need them):

```sh
npm run build --workspace=packages/strategist
npm run build
STRATEGY_PAGE_PREVIEW_DIR=/tmp/strategy-page-preview \
  npm test --workspace=packages/publisher -- \
  src/web/pages/consumer-page-content.test.tsx \
  -t "renders actual ST2 strategy"
```

The existing test path opens the actual ST2 example root, resolves Writer drafts,
constructs exact candidate revisions, adopts the native component dependency
closure through Designer's existing API, and requires a ready native assembly
before rendering list and detail. The expected-positive assertion remains active.
On the measured package baseline it is **BLOCKED**: the all-surface fixture's
27 component runtime observations are absent. Independent selected-closure
inspection also found at least 19 declared components needing observations;
narrowing the fixture does not provide that evidence. No observation or ready
receipt is synthesized. No full-page HTML is written for a pending route.

After genuine matching observation evidence satisfies native preparation, the
test can save `strategy-list.html`,
`strategy-detail.html` and `strategy-provenance.json` in the requested scratch
directory. HTML uses existing token/preview CSS and the single selected native
frame. The adjacent strategy tests cover partial/missing/error states, literal
roundtrips, limits, ownership and source crossings; the browser test preserves
the server-entry refusal.

This proof uses local fixture slot/candidate identities and synthetic flow
substrate declarations/measurements. It does not supply the missing component
runtime observations or claim an adopted Admin route. A consumer must still
register its actual source modules, native library and publication, select its
canonical slot/candidate revisions, supply its loaders/runtime evidence, and
adopt the resulting route. No live consumer URL is implied by this example.

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
their Writer records. The helper requests Writer's explicit `preview` target
and retains draft status and activation `none`. Preserve the draft marker when
presenting preview copy. Production resolution uses Writer's approval policy;
this helper does not promote drafts or manufacture approval.

`copyPreview` on the returned page registry is derived from the resolved Writer
provenance: `{ target: "preview", draft: boolean }`. Keep
`data-copy-target="preview"` and, when `draft` is true,
`data-copy-status="draft"` on the consumer's existing frame root. A resolved
preview is not a production approval or a publication clearance.

English ICU uses Writer's formatter. The two genuine Arabic literal records
can be addressed with `locale: "ar"`; there is no English fallback. Non-English
ICU and missing/retired records refuse. No second message formatter is supplied.

## Define composition and map references

A `ConsumerPageConfig` is serializable data with `version`, `id`, `entryId`,
`namespace`, a Writer-ref `title`, `levels`, `columns`, `copy` bindings and an
optional `item`. The repository example is
[`examples/admin-pages.config.json`](../../../examples/admin-pages.config.json).
Publisher does not import these example configurations at runtime. Keep the
publication's actual configurations in the consumer.

The four levels declare semantic verbs and existing selected section styles:

| Level | Verb | Consumer composition |
| --- | --- | --- |
| L0 | `normalize` | `header` and optional `empty` section |
| L1 | `unlock` | `band`, `header` and repeat `key` |
| L2 | `cohere` | `table` and repeat `key` |
| L3 | `create` | row `key` |

These verb ids describe the levels; displayed labels still resolve through
Writer. A style supplies the existing section leaf, optional config and member
selection. `columns` supplies each key, kind and Writer-ref label. `copy`
supplies the outline/count, item, table and chat Writer refs. An optional
`item` names its map entry and supplies ordered sections as
`{ id, label, estimate, fill }`, where `fill` is native `SectionFill` data.
There are no page-body callbacks or consumer-authored JSX in this model.

Each list map entry has `kind: "page"` and `pageConfig: config.id`, and its id
matches `config.entryId`. If `config.item` exists, the item entry has the same
`pageConfig` reference and the id in `config.item.entryId`. Map entries own
paths and `source.planItemId`; configuration ids are not route paths.
`pageConfig` is refused on non-page entries. Missing, duplicate and orphaned
configurations, mismatched identities or titles, and missing source modules
are refused before route construction. A map title must equal the Writer
resolution of the corresponding configuration title or current item title.

## Build a consumer registry

`createConsumerPageRegistry({ publication, channel, map, configs, copy, manifests,
sources, brand?, itemL0?, itemTitles? })` returns
`{ registry, pages, map, manifests, publicationHosts, copyProvenance, copyPreview }`.
The returned `map` enriches route-only entries with the native page's placement-backed
manifest and Section constructs. Use it for navigation, outline, ToC, commands and
sitemap projections. Supplied map manifests and constructs must match the generated
native page, including counts, Writer labels and placements; conflicts are refused.
`publication` supplies the selected frame, layout, mainSlot and
`context.consumer`; its id and format must agree with the map. Mount its
Designer frame once. Supply a valid `PublisherChannelId` explicitly: the admin
uses `admin`, while the inventory example below uses `site`. Channel selection
does not depend on configuration names.

`manifests`, `sources`, `itemL0` and `itemTitles` are keyed by configuration id.
Each `pages[config.id]` contains `list`, optional `item`, `manifest`, optional
`itemManifest`, `query`, `staticContent`, `createSession`, `levels` and
`copyProvenance`. A loader skeleton is
`{ l0: [{ id, label: { id: writerAlias }, count, estimate, partition?, l1: [...] }] }`;
L1/L2 labels are also Writer refs.

For every configured route, supply actual consumer module identities through
`sources[config.id]`: `list: { entry, source }`, optional
`item: { entry, source }`, and `runtime`. `brand`, when provided, is
`{ homeRouteId, label: WriterRef }`; otherwise the first configuration supplies
the home entry and Writer-ref label.

For example, consumer configuration and map data can be joined in a client
runtime as follows. The sample names describe consumer-owned imports and
values, not modules installed by Publisher:

```ts
import { createAdminPageCopy, createConsumerPageRegistry } from
  "@clossys/publisher/web/admin-pages";

const copy = createAdminPageCopy({ locale: "en", envelopes });
const publication = createConsumerPageRegistry({
  publication: selectedPublication,
  channel: "site",
  map: contentMap,
  configs: pageConfigs,
  copy,
  manifests,
  sources,
});
const inventory = publication.pages.inventory.createSession({
  publication: publicationSession,
  navigation,
  loaders: inventoryLoaders,
});
```

Here `envelopes` is the server result above. `selectedPublication` and
`publicationSession` describe the same selected, persistent frame. The
consumer supplies a configuration whose id is `inventory` and whose entry is
linked from `contentMap`. Use `publication.registry` and that entry's id with
`RegisteredRoutePage`; supply the returned session bundle through the selected
runtime as described below.

For an item route, `itemTitles[config.id]` is a Writer ref for the actual item
name and `itemL0[config.id]` selects its concrete L0. Live item sessions require
the item title. It names the frame trail, detail title and selected outline
entry; the item map entry's title must agree. Then pass `item: true` and the
concrete `itemPath` to `createSession`. Rebuild the binding when concrete item
parameters, map title or Writer title change. The route path comes from the map.

To migrate the admin's three pages, move their compositions and columns into
consumer configuration data, add each map entry's `pageConfig` reference, key
the existing manifest/source maps by config id, and replace
`createAdminPageRegistry` or the named factories with
`createConsumerPageRegistry`. Keep the same selected publication, router,
Writer envelopes and loader/session boundary.

## Bind data before it enters the page cache

UI values in loader data use `writerCopy({ id, locale?, values? })`. For example,
a header is `{ text: writerCopy({ id: "strings.admin.page.writer" }), id: "strings" }`.
Rows use Writer refs for displayed names, text, status labels and other UI copy.
Raw display strings refuse. Structural ids, refs, hrefs and numbers remain data;
`adminTechnicalData(kind, value)` explicitly represents supported identifiers,
links, locales, dates or chat-message content. Technical markers cannot replace
a heading or label.

`consumerPageRef(namespace, name, type?)` constructs
`{ kind: type ?? "records", ref: "<namespace>/<name>" }`. Use the namespace from
the consumer configuration. Loader content records
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

Call `pages[config.id].createSession({ publication, navigation, loaders, ... })`,
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

The section hosts use the configuration's Writer refs to supply `recordDetail`
only to record-detail, and `tableCopy`/`paginationSummary`/`formatCopyMessage`
only to data-table.
The detail title and fields
come from the current Writer-bound item. Empty-table copy and the complete
pagination summary come from Writer records.

`paginationSummary` is serializable data, not a callback:
`{ key: "pagination.totalText", writerId, locale, message, values }`.
Its raw ICU message and canonical id come from the genuine bound Writer record.
The section supplies its live `start`, `end`, `total`, `page`, `pageCount` and
`pages`, preserving other authored arguments. `formatCopyMessage` verifies the
message identity and delegates to Writer's explicit preview resolver; Publisher
does not parse ICU or carry a second formatter. Obsolete callback summaries and
forged message text refuse.

Use one shared chat binding set across the publication's configurations;
conflicting chat copy references are refused. At
the publication host's one-time `bind`, use
`publicationHosts["sections.chat"]` for the shared inspector renderer. It
supplies both root labels and all 19 Chat labels, including code-copy states.
Pages replace inspector context, not the Chat mount or its thread. Missing
required native copy ports refuse; no specimen dataset or English component
defaults are used by these selected renderers.

## Structured documents

Publisher also owns `SectionedViewDocument`, its validation and
`resolveSectionedViewDocument` through `@clossys/publisher/core`. Prepare
structured documents through that server-side composition entry and import
its types where needed. Consumer documents use Writer CopyRefs rather than
the Designer landing document model. Resolution still requires a Writer
resolver and does not provide page copy or approval defaults.

The consumer still supplies the selected library, manifests, CSS, source
closure, frame adapter and live loader data. Publisher tests use real Writer
records and selected renderers with explicit fixture flow declarations. They
do not qualify a consumer's installed catalog, library refresh, 4503 adoption
or the full A108 landing check.

## Checked consumer composition and content ownership

The browser `createConsumerPageRegistry` factory constructs unbound preview
records. It does not establish Publisher slot or candidate ownership.

The server entry `@clossys/publisher/web/registered-route-check` exports
`prepareConsumerPageRegistry` and `prepareConsumerPageRoute`. Store a version-1
`ConsumerPageCompositionSnapshot` in each selected candidate's
`typeSettings.consumerPage`. Its data is the existing registry options without
the runtime `copy` function: publication, map, configs, taxonomy manifests,
source references and optional item/brand bindings. Every selected route must
own the same snapshot bytes. These bytes participate in the existing candidate
revision digest; there is no separate approval or revision lifecycle.

Use `consumerPageContentSelection(snapshot, routeId, copy)` to obtain the
canonical frame and ordered Section identities for the existing candidate
Composition. The legacy Composition identity format names its base config
`default`; an omitted native config stays omitted in the actual native binding.
Do not turn this compatibility identity into a named native config.

Pass the content registry, locale, Writer-backed copy and exact
`{routeId,slotId,candidateId,revision,digest}` selections to
`prepareConsumerPageRegistry`. It consumes the current active candidates'
stored data, checks their actual immutable digests and exact route/slot closure,
and derives the native registry from those bytes. Missing or foreign identities,
unsnapshotted edits and different composition data refuse. Returned identity and
composition data is frozen. `prepareConsumerPageRoute` checks the live selection
again, requires the selected native library version and then runs the existing
native preparation gates. A copied object or a caller-provided ownership flag
cannot replace that checked boundary. Assembly identity is not release approval.

A checked config must explicitly choose `pageModule`: a native `SectionFill`,
or `null` for no page module. The unbound factory alone retains its historical
TOC default when the property is omitted. A selected module's complete fill and
references remain part of the candidate revision; native contract and source
checks still decide whether it can render.

The current app-shell TOC composition has a separate label-contract limitation:
its renderer requires page-module label content while the selected native
contract supplies a Section slot. This unit neither injects undeclared content
nor changes that contract. An explicit no-module composition can render the
real selected frame; it is not proof that the existing Admin TOC composition or
persistent frame delivery works. Persistent SSR belongs to its separate runtime
work. Actual consumer migration, checked source/slot/candidate evidence for all
routes, and live adoption are still consumer responsibilities.

The native manifest also requires one descriptor per adopted fill identity.
Different named configurations of the same adopted leaf cannot currently be
combined in one assembly by duplicating that identity. Consumer choices remain
subject to this native gate. The acceptance fixture deliberately selects one
registered header configuration for both taxonomy levels; it does not qualify
the existing Admin combination of several header configs.

## Render the persistent publication during SSR

An imperative `setRegions` host cannot insert server-rendered nodes into a frame
mounted elsewhere. For SSR, give `createRegisteredPublicationSession` a stable
`host.Frame` adapter around the selected Designer frame. Its
`RegisteredPublicationFrameProps` contain the selected `publication`, stable
navigation/search `ports`, and an immutable `snapshot`: `regions`, `state`,
`commands`, and `chunks`. Forward those props into the selected frame. Render
`snapshot.regions.main` once; for a stream it contains all currently ready native
chunks. An adapter that renders chunks individually uses `snapshot.chunks` in
place of that main array, retaining the supplied order and load/status metadata.

`RegisteredRoutePage` renders `RegisteredPublicationOutlet` for this adapter,
including on the server. It prepares the initial snapshot without activating a
session, calling host setters, or requesting lazy content. Hydration reads that
same initial snapshot, then subscribes to the publication's stable
`getSnapshot`/`subscribe` store. Page and state updates change frame props; they
do not key or replace the frame or its shared chat. A pending or refused page
retains the shell and its previously selected regions while displaying the frame
route state. Keep the session, host and Frame component stable across route
changes, and create sessions per publication/request rather than sharing server
request state globally.

Page startup is memoized for the current hash and concrete path. An explicit
item load invalidates that memo. Returning to the plain page clears item-owned
content and route state, cancels late item results, and lets normal preparation
derive the page's ready or pending state.

Mount the adapter only through this outlet. Remove the old external frame mount;
`bind` and the imperative setters may mirror data but must not create another
frame or chat. Setter-only hosts keep their existing client publication behavior
and do not provide SSR. Consumer adoption must supply the real selected Designer
frame and installed runtime inputs; the lifecycle fixture in Publisher proves
native selected main SSR/hydration and frame/chat identity using a synthetic host,
not an installed consumer frame or live-route qualification.
