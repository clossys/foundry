# @clossys/publisher

**The publisher role — did we put it out to an audience, and can we prove
what shipped?** This package is named for the job, not the artifact: it is
recut from two donor packages, `@example/surface` (the composer half
— eight subpaths, unchanged) and `@example/ledger` (the record half,
now the `./record` subpath), per
[decision 10](../../docs/DECISIONS.md#10-recutting-the-expression-surface-into-role-shaped-packages).
The vocabulary inside each half is unchanged: renaming the role does not
rename what it composes or what it records.

```bash
npm install @clossys/publisher
```

## Public entry points

Use explicit subpaths:

- `@clossys/publisher/core` — canonical `SurfaceDocument` contract, validation, copy/media resolution, and output manifests.
- `@clossys/publisher/media` — media registry, reader, and coverage check.
- `@clossys/publisher/web` — web composition and head metadata. Under React's
  `react-server` export condition it resolves a server-safe target with the
  same runtime export names and Designer's server-only component barrels;
  ordinary imports retain the interactive React Aria FAQ.
- `@clossys/publisher/document` — the product-neutral structured-document contract (sections, paragraphs, lists, tables, callouts, safe links) and its renderer.
- `@clossys/publisher/email`, `/print`, `/image`, `/slides` — channel renderers.
- `@clossys/publisher/record` — the append-only, content-addressed publication ledger and its drift checker. See "`record` — the append-only publication ledger," below.

The package has no root export. `core` is deliberately framework-agnostic;
the web and document subpaths have optional React peers, while `web` also
declares Designer's optional runtime peers directly so a public-registry
consumer receives a complete, inspectable peer contract. Non-web renderers do
not require them at runtime. `record` is pure and has no peer dependencies of
its own.

The web condition changes only the implementation selected for server
rendering, not the API. `MarketingView` keeps the same props and regional
layout; its server target uses Designer's native `details`/`summary` FAQ while
the ordinary target keeps Designer's React Aria FAQ. `AuthView`, `ErrorView`,
`CaptureView`, `CollectionView`, `DocumentView`, the renderer functions,
template helpers, error class, and all runtime export names are present in
both targets.

## Why `publisher` is one package, not two

Composition without a record is unprovable, and every time the publisher
runs, the record runs — there is no publish that legitimately skips it. That
argues for one install and one version, which one package with a `./record`
subpath delivers.

The measurement that originally argued for two separate packages is
accommodated rather than overturned: **the record shares no code with the
composer and does not import it**, so the two import surfaces stay genuinely
separate under one version. Fusing the *packaging* was never the same as
fusing the *dependency graph*, and only the second would have cost anything —
see "`record` — the append-only publication ledger," below, for the half
that proves it: a publication record is a DOCUMENT the composer never
imports.

## Scope: this package renders and validates. It does not compose.

Stated plainly because evaluating it and discovering this costs real time:
**there is no compose step here, and there will not be one.** Nothing in this
package takes an intent, a brief, or a content plan and *selects* a template
to put it in. Every export is a `render*`, a `resolve*`, or a `validate*`.

The boundary is: a caller authors a `SurfaceDocument` — naming its template
explicitly — and this package validates it, resolves its copy and assets
against real approved registries, renders it for a channel, and reports what
it did. Deciding *which* document to build, from *what* intent, is the
consumer's job and stays there.

This is a scope decision, not a gap awaiting a contributor. Template selection
is where product judgement lives: which page shape serves which audience at
which moment is exactly the reasoning a shared package cannot hold for someone
else, and a `compose(intent, target)` that guessed would be wrong in a way
that is expensive to discover and impossible to override cleanly. Drawing the
line at "you name the template, we guarantee everything after it" is what lets
this package promise something real — validated content, resolved copy
provenance, deterministic output — instead of promising judgement it does not
have.

What that leaves the consumer owning: intent-to-template selection, and any
catalog of their own templates worth selecting from. What it leaves this
package owning: everything from a named template onward.

Making the *set* of selectable web templates extensible is a separate and
genuinely open question — see the template-registry proposal in this
repository's issues. That is about who may add a template, not about who picks
one; extensibility does not imply composition.

## SurfaceDocument and renderer boundary

`SurfaceDocument` is the canonical authored contract. It replaces the
string-bearing `ComposeDocument` with `CopyRef` values for audience-facing
slots and metadata: web titles/descriptions, email subjects/preheaders, image
alt text, and slide notes. A binding is exactly one of `copy`, `node`, or
`assetId`; `node` preserves an explicit consumer-provided interactive/rich UI
node without pretending it is copy. Use `resolveSurfaceDocument(surface,
copyResolver)` at render time: it
validates the canonical document, resolves every required `CopyRef` against a
real approved registry, returns renderer-facing data plus the full resolution
provenance, and fails closed for invalid, missing, or unsupported node
bindings. New consumer code authors `SurfaceDocument`; `ComposeDocument` is
the renderer-facing shape produced by this package, not a consumer migration
API.

Web and email templates use `FlowLayoutSpec`, which contains ordered keys and
requiredness only. Print, slides, and image surfaces use `CanvasLayoutSpec`
with frames and element kinds. This prevents flowed surfaces from carrying
fictional canvas geometry.

### Repeating-group bindings

A `SurfaceDocument`'s `bindings` array accepts two shapes: a
`SurfaceSlotBinding` (one slot, exactly one of `copy`/`node`/`assetId`, as
above) or a `SurfaceRepeatingSlotBinding` — the same slot, bound to an
**ordered list** of items instead of a single source. This closes part of
issue #166: a template can commit a slot to holding N items (a capability
grid, a stat band, a testimonial list) where N is a run-time fact the
template's own layout cannot encode, since `FlowLayoutSpec`/`CanvasLayoutSpec`
name a slot once, not "this slot, repeated."

A repeating binding still names one explicit slot the consumer already
decided exists — it does not select a template or invent a slot, the same
boundary every other binding in this package holds to (see "Scope," above).
Each item in `items` independently obeys the identical exactly-one-of
discipline a single binding does. For a one-value item, use `copy`, `node`,
or `assetId` as before. For ordinary multi-field editorial content, use one
named `fields` map instead; each field is exactly one `copy` or `assetId`
binding. A field may never be a `node`, so structured copy cannot bypass the
registry, voice checks, locale selection, or output provenance.

```ts
import type { SurfaceDocument } from "@clossys/publisher/core";

const acmeCapabilities: SurfaceDocument["bindings"][number] = {
  slot: "capabilities",
  items: [
    { copy: { id: "acme.capability.one" } },
    { copy: { id: "acme.capability.two" } },
    { assetId: "acme.capability.icon.three" },
  ],
};
```

Templates opt into structured items by declaring their accepted field names
and requiredness in `repeatingSlots`. At render time, an unknown field, a
missing required field, a malformed field map, or a legacy one-value item
against a structured slot fails closed. A field map against a slot that did
not declare fields fails closed too. This keeps the template—not a caller's
ad hoc object—the authority for the repeating item's shape.

`items` may be an empty array. That is a deliberate choice, not an
oversight: this package cannot tell "the consumer configured zero of these
on purpose" (a legitimately-empty testimonial list) apart from "something
upstream failed to populate this," so it validates an explicit `items: []`
as clean rather than guessing. See `types.ts`'s `SurfaceRepeatingSlotBinding`
doc comment for the fuller reasoning.

`resolveSurfaceDocument` resolves a repeating binding's items in order and
returns them on `ResolvedSurfaceDocument.groups` — an array of
`{ slot, items: [{ index, value?, node?, assetId?, fields? }, ...] }` — rather than
folding them into the legacy `ComposeDocument.bindings` shape, which has no
way to carry more than one source per slot. `groups` is omitted entirely
(not an empty array) on a document with no repeating binding, so an existing
single-binding-only `SurfaceDocument` resolves identically to before this
existed. A bad item — an unresolvable `CopyRef`, same as any single
binding's — fails the whole `resolveSurfaceDocument` call with a message
naming the specific item (`bindings.N.items.M`), the same fail-closed,
all-or-nothing contract this function already holds for a single binding;
it does not invent a second, partial-success mode just because the content
is array-shaped. Per-item copy resolutions flow into the same
`resolutions`/`collectCopyProvenance` provenance path a single binding's
does, so a repeating-group slot shows up in manifest provenance per item,
not just per slot — see `output-manifest.ts`. A structured field resolved
from `assetId` instead carries registry-validated asset evidence into the
target renderer; it has no copy provenance because it is not copy.
At the public `RenderWebOptions.groups` boundary, items must retain the
resolver's contiguous source order: item `index` is exactly its zero-based
array position. This prevents a direct caller from silently reordering,
duplicating, or sparsifying the authored group after resolution.

### Structured repeating-item migration and planned semver boundary

Publisher `0.1.10` exposed the FAQ repeat as a legacy one-value/node-shaped
contract. That shape cannot represent two separately governed editorial
fields, and it is not compatible with the structured FAQ contract above.
Migrate each FAQ item from a caller-authored node to explicit approved-copy
fields:

```ts
// Before: legacy node-shaped FAQ item (do not carry this forward).
{ node: { question: "...", answer: "..." } }

// After: every audience-facing field is a CopyRef.
{
  fields: {
    question: { copy: ref("acme.faq.question") },
    answer: { copy: ref("acme.faq.answer") },
  },
}
```

This is a breaking contract correction, so the pending Publisher successor
is planned as `0.2.0`; a `^0.1.x` range must not satisfy it. The package
version remains `0.1.11` until the separate #663 Designer-block integration
joins this final site-readiness unit and one exact-head `0.2.0` candidate is
qualified. This statement plans neither a version bump nor publication.

### `SectionedViewDocument` — Designer-independent long-page core

`@clossys/publisher/core` now owns the closed, data-only source model for a
long public site page: `SectionedViewDocument`. It requires one or more
ordered sections with unique lowercase fragment-safe ids and one of five
named kinds: `hero`, `feature-grid`, `faq`, `ordered-step-sequence`, or
`status-list`. Grounds are the closed `base`/`sunken`/`inverse` vocabulary;
status values are the closed `available`/`partial`/`planned` vocabulary.
Every audience-facing label, heading, description, question, answer, ordinal,
and status label is a `CopyRef`. There are no React nodes, render callbacks,
router fields, locale overrides, classes, styles, arbitrary colours, or
composition escape hatches.

This is a closed wire model at runtime as well as in TypeScript: structural
objects use only enumerable own data properties (no inherited, symbol, hidden,
or accessor fields), and every ordered section, item, and status-group array
must be dense. A `CopyRef` has only its non-empty `id`, optional non-empty
`locale`, and an optional plain interpolation-value record whose values are
strings, numbers, or booleans. Malformed input is rejected before a custom
resolver is called.

`validateSectionedViewDocument` reports malformed or unknown structure;
`resolveSectionedViewDocument` resolves every CopyRef depth-first in authored
order and returns its ordinary `CopyResolution[]`. Pass that list directly to
`collectCopyProvenance` or existing output-manifest helpers—there is no second
provenance format. A missing or empty resolution fails the entire document and
names the exact authored path. This core stage intentionally imports neither
React nor Designer and does not render a web view. The grounded web renderer
uses Designer `0.2.6`'s server-safe site-block API.

`SectionedView` is now the dedicated web renderer after that Designer floor is
available. Resolve the CopyRef document first, retain its `resolutions` as the
only publication provenance, and pass the resolved model directly:
Here `resolveCopy` is the consumer's approved `CopyResolver`.

```tsx
import { resolveSectionedViewDocument } from "@clossys/publisher/core";
import { SectionedView } from "@clossys/publisher/web";

const resolved = resolveSectionedViewDocument({
  id: "acme-home",
  sections: [{
    id: "welcome",
    kind: "hero",
    ground: "base",
    heading: { id: "acme.home.heading" },
    description: { id: "acme.home.description" },
  }],
}, resolveCopy);

const page = <SectionedView document={resolved} />;
// resolved.resolutions feeds collectCopyProvenance/output-manifest helpers.
```

The ordinary and `react-server` `@clossys/publisher/web` exports are aligned.
The view owns section markup, source order, unique section ids, grounds, and
the h1/h2/h3 outline; Designer owns visual tokens and block internals. Per
#708, Publisher does not own locale selection, routing, or document-level
`html`, `lang`, or `dir` attributes: the host application supplies those
boundaries around this renderer.

`section-header` and `article-body` are intentionally not section kinds in
this core stage: the former's action region and the latter's full structured
document rendering need a grounded view integration to remain fully
data-shaped and provenance-complete. They are not represented as node slots.

On its own, this is a repeating-group *binding* primitive only — it says
nothing about which template actually consumes it. `web`'s `MarketingView`
template (below) is that consumer, closing the second and final half of
issue #166.

### `MarketingView` — the flowed marketing template

`web`'s template registry (`listWebTemplateNames()`) knows three names:
`AuthView`, `ErrorView`, and `MarketingView` — an ordinary flowed page with
a persistent header/footer, a hero, a feature grid, an optional FAQ list,
and a closing call-to-action band. Like `AuthView`/`ErrorView`, it is one
more explicit, nameable `SurfaceDocument.template` value, not a mechanism
that picks one — see "Scope," above: this package still does not compose.

`MarketingView`'s fixed slot set: `brand` and `heroHeading` and
`ctaHeading` are required flowed text slots; `heroEyebrow`,
`heroDescription`, `heroActions`, `heroMedia` (an asset slot),
`featuresHeading`, `featuresDescription`, `faqHeading`, `faqDescription`,
`ctaDescription`, `ctaAction`, and `footerSecondary` are optional flowed
slots; `features` (required) and `faq` (optional) are **repeating** slots,
each bound via a `SurfaceRepeatingSlotBinding` and rendered through
`@clossys/designer`'s `FeatureGrid`/`Faq` blocks respectively. An empty
repeating group (`items: []`) renders that section with zero entries —
never an error, the same "empty is a deliberate, valid choice" contract
`SurfaceRepeatingSlotBinding` itself holds to, above; a `faq` binding that
was never authored at all omits the whole FAQ section instead, which is a
different, equally valid outcome (see `MarketingView`'s own `faq` prop doc
comment).

`faq` declares two required structured fields: `question` and `answer`.
Each resolves through the normal `CopyRef` path, so its locale, approved
voice, and provenance stay visible alongside the rest of the page. A FAQ
item authored as a caller-owned `node`, as a legacy single value, or with an
unknown/missing field is refused rather than bypassing editorial governance.

```ts
import type { SurfaceDocument } from "@clossys/publisher/core";
import { resolveSurfaceDocument } from "@clossys/publisher/core";
import { renderWebDocument } from "@clossys/publisher/web";

const ref = (id: string) => ({ id });

const acmeMarketingHome: SurfaceDocument = {
  id: "acme.marketing.home",
  channel: "web",
  template: "MarketingView",
  meta: { channel: "web", title: ref("acme.brand"), description: ref("acme.hero.description") },
  bindings: [
    { slot: "brand", copy: ref("acme.brand") },
    { slot: "heroHeading", copy: ref("acme.hero.heading") },
    { slot: "heroDescription", copy: ref("acme.hero.description") },
    { slot: "ctaHeading", copy: ref("acme.cta.heading") },
    // Required repeating slot; an explicitly empty grid is valid.
    { slot: "features", items: [] },
    // A repeating slot — one CopyRef per placeholder feature, in order.
    {
      slot: "faq",
      items: [
        {
          fields: {
            question: { copy: ref("acme.faq.one.question") },
            answer: { copy: ref("acme.faq.one.answer") },
          },
        },
      ],
    },
  ],
};

const resolved = resolveSurfaceDocument(acmeMarketingHome, myCopyResolver);
const { element, head } = renderWebDocument(resolved.document, {
  groups: resolved.groups, // carries the structured FAQ fields
});
```

`resolved.groups` is exactly `ResolvedSurfaceDocument.groups` — pass it
straight through as `RenderWebOptions.groups`; `renderWebDocument` maps
each declared repeating slot's resolved items onto `MarketingView`'s
`features`/`faq` props in authored order. Passing a group for a slot
`MarketingView` does not declare as repeating, or omitting the required
`features` group entirely, both fail closed with
`RenderError("resolution-failed", ...)` — the same error contract a
missing/unknown single-slot binding already produces for `AuthView`/
`ErrorView`.

### `CaptureView`, `DocumentView`, and `CollectionView` — fixed publisher page shells

These exports are direct, server-safe page shells rather than new
`SurfaceDocument.template` registrations. They deliberately do not select
content, load a CMS, own a router, or add client state.

`CaptureView` provides the site chrome, one heading, a consumer-owned form
region, and a footer. The consumer owns form fields, submission, validation,
and network effects. On a failed client-side submission, pass both
`errorSummary` and `errorSummaryId`, focus that id, and keep the summary
before the form; the view makes it a focusable `role="alert"`. On success,
pass `submitted`: it replaces the form in the same position in a polite live
region. `CaptureView` intentionally does not choose a form library, add spam
handling, or model submission state.

`DocumentView` accepts a `StructuredDocument` and an approved-copy resolver,
then calls `renderStructuredDocument` itself. A caller cannot supply a
pre-rendered article node or skip heading and in-document-fragment validation
on this path. The document title becomes the page `h1`; optional summary and
effective-date labels remain `CopyRef`s. An effective date is
`{ dateTime, text }`, so its visible approved copy is paired with a semantic
`time` value; `dateTime` must be a real ISO date or date-time, not arbitrary
display text. Invalid document structure, unresolved fragments, missing copy,
and malformed effective-date metadata fail closed with `RenderError`.

`CollectionView` supplies an accessible collection index: each non-empty
entry has a unique linked title, a semantic `time`, optional summary and tag
list, and a navigation landmark for consumer-owned pagination. Its required
`empty` state prevents an empty index from silently becoming a blank region.
Entries use a deliberately small closed shape (`id`, `href`, string `title`,
`date`, optional string `summary`/`tags`); its raw props are consumer-owned
view data and do not themselves carry CopyRef provenance. Consumers that need
editorial provenance resolve structured fields before constructing these
strings, while Publisher's structured renderer continues to retain the
underlying field-level copy/asset evidence. Pagination and empty-state actions
are likewise `{ href, label }` data, not node escape hatches. Route loading,
taxonomy, and paging state remain outside Publisher. If a router replaces collection items in place, it
must move focus to `focusTargetId` (the focusable `PageHeader` region that
contains the view's `h1`); ordinary links retain normal browser route focus
handling. Entry, empty-state, and pagination links accept only a fragment,
a single-root-relative path (never `//`), `http(s)`, or non-empty `mailto:`;
script, data, file, and protocol-relative URLs fail closed.

There is intentionally no `EntryView`. A document-backed entry page uses
`DocumentView`, with its optional header action linking back to the
collection, rather than duplicating the validated document page contract.
This is the narrow disposition for entry pages; it does not add CMS, parser,
or taxonomy behavior. A future Designer-block integration is separately
staged and is not part of these publisher shells.

### `defineWebTemplate` / `createWebRenderer` — an extensible, instance-scoped web-template registry

`AuthView`, `ErrorView`, and `MarketingView` are this package's own three
templates. `defineWebTemplate` and `createWebRenderer` let a consumer
register their *own* page shapes against the same `web` renderer pipeline —
the same validation, resolution, and provenance guarantees, extended to a
template this package never shipped.

**This is still not composition.** `SurfaceDocument.template` remains a
plain string the caller names explicitly on every document — extensibility
here is about *who may add* a template (now: any caller, not just this
package), never about *who picks one* at render time. See "Scope," above:
this package still renders and validates; it does not compose.

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SurfaceDocument } from "@clossys/publisher/core";
import { resolveSurfaceDocument } from "@clossys/publisher/core";
import { createWebRenderer, defineWebTemplate } from "@clossys/publisher/web";
import { DashboardWidget } from "./DashboardWidget.js"; // a consumer's own component

const DashboardView = defineWebTemplate({
  name: "DashboardView",
  flow: { slots: [{ key: "heading", required: true }, { key: "widget", required: true }] },
  // A slot key absent from slotKinds defaults to ["copy", "asset"] — the
  // same two sources AuthView/ErrorView's slots already accept. "widget"
  // opts INTO "node" explicitly, per slot — never a renderer-wide switch.
  slotKinds: { widget: ["node"] },
  build: (content) => createElement("main", null, createElement("h1", null, content.heading), content.widget),
});

// Every renderer instance is isolated — see "Instance-scoped, never a
// global mutable registry" below. `includeBuiltins: true` additionally
// registers AuthView/ErrorView/MarketingView on this same instance.
const renderer = createWebRenderer({ templates: [DashboardView], includeBuiltins: true });

const ref = (id: string) => ({ id });
const acmeDashboard: SurfaceDocument = {
  id: "acme.dashboard.home",
  channel: "web",
  template: "DashboardView",
  meta: { channel: "web", title: ref("acme.dashboard.heading"), description: ref("acme.dashboard.heading") },
  bindings: [
    { slot: "heading", copy: ref("acme.dashboard.heading") },
    // A caller-owned, already-composed React element — never a raw HTML
    // string, never audience-supplied content. See "Rich-node slots" below.
    { slot: "widget", node: createElement(DashboardWidget, { chartId: "acme.chart.mrr" }) },
  ],
};

// Tell resolveSurfaceDocument which of THIS template's slots accept a
// node — derived from the template's own declaration, never hardcoded.
const resolved = resolveSurfaceDocument(acmeDashboard, myCopyResolver, {
  nodeSlots: Object.entries(DashboardView.slotKinds ?? {})
    .filter(([, kinds]) => kinds.includes("node"))
    .map(([slot]) => slot),
});

const { element } = renderer.renderWebDocument(resolved.document, {
  groups: resolved.groups, // repeating slots, if the template declares any
  nodes: resolved.nodes, // resolved single-binding node slots
});
renderToStaticMarkup(element);
```

**What a consumer-defined template is still forced through.** A `build`
function only ever receives already-validated, already-resolved `content` —
it never sees or influences a raw `SurfaceDocument`, so it cannot become a
path around validation:

- `validateSurfaceDocument`/`validateComposeDocument` run unchanged on
  every document, built-in template or not — a custom template does not
  bypass shape validation of `bindings`, `meta`, or `layout`.
- `resolveDocument`'s `ok`/`missingRequired`/`unknownBindings`/
  `bindingFindings` contract (issue #43's "resolved nothing is never
  `ok: true`" bar) is reused as-is for a custom template's `flow`.
- `renderWebDocument`'s "every required slot must resolve to real content
  or the render throws" discipline (`RenderError("empty-output", ...)`)
  applies identically, whether that content came from a `copy` binding, an
  `assetId`, or an authorized `node`.
- `createResolvedOutputManifest`/`collectCopyProvenance` receive the same
  `CopyResolution[]` for a custom template's `copy`-kind slots as they do
  for `AuthView`/`ErrorView`'s — a custom template is never a hole through
  which resolved copy reaches a page without leaving the provenance trail
  every other slot leaves. A `node`-kind slot's content is the one
  documented exception: it never goes through `CopyRef` resolution at all
  (it is not audience-facing copy), so it contributes no `CopyResolution`
  and appears nowhere in `resolutions`/manifest copy provenance — that
  absence is the intended behavior, not a gap.

**Rich-node slots are the dangerous surface, so they are the narrow one.**
A `"node"`-kind slot accepts a real `ReactNode` the caller's *own trusted
code* already constructed — a composed `AuthView` form, a widget built from
`@clossys/designer` atoms, a small caller-authored component. It never
accepts and never interprets a raw HTML string, and there is no
`dangerouslySetInnerHTML` anywhere on this path — React's own
child-rendering already escapes text/attribute values by default, and a
node slot's safety rests entirely on staying inside that path. `"node"` is
opt-in *per slot*, declared explicitly in `slotKinds`; a slot left off
`slotKinds` (or listed without `"node"`) never accepts one, and every
mismatch — a node for an unregistered or non-node-kind slot, a copy/asset
binding against a node-only slot, a node colliding with a slot a copy/asset
binding already filled — fails closed with
`RenderError("resolution-failed", ...)`, never silently coerced or dropped.
`core`'s own `resolveSurfaceDocument` mirrors this at the canonical-document
layer: a single binding's `node` still refuses unconditionally
(`SurfaceResolutionError("unsupported-node", ...)`) unless its `slot` is
named in that call's own `nodeSlots` option — an opt-in allowlist a caller
builds from the target template's own `slotKinds`, never inferred.

**Instance-scoped, never a global mutable registry.** `createWebRenderer()`
with no arguments knows *zero* templates — not the three built-ins.
`AuthView`/`ErrorView`/`MarketingView` remain exported, unchanged; the
module-level `renderWebDocument`/`listWebTemplateNames` functions (this
package's only entry point before this feature existed) keep rendering
them exactly as before — a zero-line diff for every existing caller. Two
independently created `createWebRenderer()` instances never observe each
other's templates, and this package exports no `registerWebTemplate` or
other function that could mutate a shared, module-level map — the
global-mutation alternative is not merely discouraged, it is structurally
absent from this package's exports. See `defineWebTemplate`'s and
`createWebRenderer`'s own doc comments for the full argument (order
dependence on import timing, and cross-consumer/cross-request collision in
a shared process, the same two failure modes a module-level mutable
registry has always risked elsewhere).

**Fails closed on a malformed definition or a duplicate name.**
`defineWebTemplate` validates `flow` (non-empty, unique slot keys — the
same discipline `validateComposeDocument` already holds a `LayoutSpec` to,
applied here to a `FlowLayoutSpec` at definition time instead of first
render), rejects a `slotKinds` entry naming a slot `flow.slots` does not
declare, and rejects a `repeatingSlots` key that collides with a flowed
slot or with itself — every one of these throws
`RenderError("invalid-template-definition", ...)`.
`createWebRenderer` throws `RenderError("duplicate-template", ...)` if two
entries (across `templates`, and the built-ins when `includeBuiltins` is
`true`) share a `name` — never silently keeps the last one registered.
Both reuse this package's existing `RenderError`/`RenderErrorReason`
contract (`internal/errors.ts`) rather than introducing a second error
type — a caller catching errors from this package never needs a second
`instanceof` check depending on whether a failure happened at template
definition time or at render time.

**One `SurfaceDocument` is exactly one canvas — pagination is out of scope
by design, not an oversight.** `LayoutSpec`'s slots are fractional positions
(`Frame = {x, y, w, h}`, 0..1 of a single fixed canvas); there is no flow,
no auto-height, and no array of canvases on the contract. This fits a
single-page artifact — an OG/share-card image, one slide, one print page —
cleanly. A multi-page document (a book, a paginated report) is a
consumer-side concern: compose it as an ordered sequence of
`SurfaceDocument`s, one per page, each resolved and rendered independently,
and assemble the resulting artifacts (e.g. concatenate PDF pages) outside
this package. `surface` has no opinion on pagination, running headers, page
numbering, or cross-page layout — those stay with whatever assembles the
sequence.

`createOutputManifest` is the lower-level hand-off seam to a consumer
publisher. `createResolvedOutputManifest(surface, resolved, artifacts,
strategyProvenance?)` is the normal pipeline entry point: it additionally
records structural copy provenance grouped by registry, revision, locale,
source, and resolved entry identifier. It intentionally excludes rendered
text and `CopyRef.values`, which can contain audience language or
request-specific data. Both helpers describe artifact paths and media types
but never write or upload files. Strategy provenance stays structural, so
this package never imports or depends on the Strategist package.

The package test suite includes a product-neutral reference pipeline fixture:
an approved, versioned `CopyRegistry` resolves all content; flowed web/email
slots avoid canvas placeholders; web, email, image, print, and slide outputs
each receive a manifest with structural strategy provenance. It also asserts
that draft or malformed sources fail closed.

## `media` — the asset registry contract, responsive images, and video (v2)

`@clossys/publisher/media` registers a consumer's own image and video
assets under a stable `assetId`, the identical role `@clossys/writer`
plays for text: a registry, never a generation engine (it never calls an
image/video API, never talks to a model, never transcodes or extracts a
poster frame — see `src/media/types.ts`'s own top comment).

**v2 (issue #177) added a required `type` discriminator, responsive image
sources, and video — a breaking change from v1.** `AssetEntry` is now a
discriminated union:

```ts
type AssetEntry = ImageAssetEntry | VideoAssetEntry;

interface ImageAssetEntry {
  id: string;
  type: "image";
  src: string;            // primary/fallback source — unchanged from v1
  width: number;
  height: number;
  alt: string;             // required, unchanged from v1
  mimeType?: string;
  licence?: string;        // optional — unchanged from v1, see below
  credit?: string;
  sources?: { src: string; width: number; format?: string }[]; // NEW — responsive <picture>/srcset
}

interface VideoAssetEntry {
  id: string;
  type: "video";           // NEW — this package's first video support at all
  sources: { src: string; mimeType: string }[]; // required, at least one
  width: number;
  height: number;
  alt: string;
  captions?: { src: string; srclang: string; label: string }[];
  transcript?: string;     // at least one of captions/transcript is REQUIRED
  poster?: string;
  reducedMotion: "pause" | "no-autoplay" | "static-poster"; // required
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  licence?: string;
  credit?: string;
}
```

**Migrating a v1 registry:** add `type: "image"` to every existing entry.
`validateAssetRecordShape`'s new `"type-shape"` rule rejects any entry with
no `type` at all — there is no silent default, on purpose (a registry that
guessed "image" on a caller's behalf would hide the one piece of
information a reviewer most needs to see stated). Every other v1 field
(`src`/`width`/`height`/`alt`/`mimeType`/`licence`/`credit`) is unchanged.

**`licence`/`credit` are not new in v2 and stay optional.** Both already
existed in v1 with real shape validation (`"licence-shape"`/
`"credit-shape"`). v1's actual gap was that a missing licence produced no
signal at all — closed not by making `licence` schema-required (which would
invalidate every already-registered v1 entry the moment its owner upgrades)
but by a new `checkAssetCoverage` finding: `"asset-missing-licence"`
(`severity: "warning"`), reported for every registered entry — referenced or
not — with no `licence`. `AssetCoverageReport` also gained `registeredByType:
{ image: number; video: number }`, so a reviewer can tell what is actually
registered without re-reading the raw JSON; `checkAssetCoverage`'s own
id-matching does not branch on `type` — an id either matches a registered
entry or it doesn't, regardless of kind.

**Video accessibility is enforced at the schema layer, not the renderer.**
A `VideoAssetEntry` with neither `captions` nor `transcript` fails
`validateAssetRecordShape` (`"video-caption-or-transcript-required"`,
`severity: "error"`) and can never reach a renderer at all — the identical
"no later recovery point" reasoning `alt`'s own required-and-non-whitespace
rule already holds images to, restated for captions (recovering one after
the fact means re-transcribing the video, not re-typing a sentence).
`reducedMotion` is similarly required
(`"video-reduced-motion-required"`), and `reducedMotion: "static-poster"`
additionally requires `poster` (`"video-static-poster-requires-poster"`).
`../internal/assets.ts`'s render-time validation (`isRenderVideoAsset`)
enforces the identical bars independently, since a hand-rolled `AssetLookup`
(a CMS, a CDN manifest, a test double) can hand a renderer a video-shaped
value that never passed through this package's own schema at all.

### Per-channel behaviour

| Channel | Responsive images (`sources`) | Video |
| --- | --- | --- |
| `web` | Real `<picture>`/`<source>`/`srcset`, falling back to the primary `<img>` | Real `<video>` with every `<source>`/`<track kind="captions">`, gated by the reduced-motion contract below |
| `email`, `print`, `image`, `slides` | Ignored — `sources` is dropped; the primary `src` renders exactly as a v1 image would | No playback capability of any kind. A video entry's `poster` renders as a plain `<img>`/`<image>`, exactly like an image asset. A video with **no `poster`** is an unresolvable asset — the render refuses (`RenderError("empty-output", ...)`), the identical fail-closed bar an unresolved `assetId` already gets. Never silently rendered as nothing. |

**Reduced motion is a rendering-time decision, not a build-time one.**
`renderWebDocument`/`RenderWebOptions.prefersReducedMotion` (issue #177) is
a caller-supplied boolean — this package has no `window`/DOM access at
render time (it may run on a server, in a build step, or in a browser), so
it cannot itself call `window.matchMedia("(prefers-reduced-motion:
reduce)")`; a caller derives that value from a `Sec-CH-Prefers-Reduced-Motion`
client hint on the server, or a direct `matchMedia` read on the client, and
passes it through. Applied against a resolved `VideoAssetEntry.reducedMotion`:

- Omitted (or `false`) — every video's own `autoplay` renders exactly as
  authored. Regression-safe: unchanged from before this option existed.
- `true` and `reducedMotion` is `"pause"` or `"no-autoplay"` — the entry's
  `autoplay` is force-suppressed; every other attribute (loop/muted/
  poster/sources/captions) renders unchanged, so a viewer can still press
  play.
- `true` and `reducedMotion` is `"static-poster"` — no `<video>` element is
  emitted at all; a static `<img>` built from `poster` renders instead.

### Explicit non-goals

- **No responsive-source or video support on `email`/`print`/`image`/
  `slides`.** `RenderAsset`'s discriminated shape is shared by all five
  channel renderers by construction, so each non-web channel must at
  minimum not crash or silently mis-render a video/multi-source entry — but
  real playback support is `web`-only, and a `<picture>`-equivalent
  construct does not exist in an SVG canvas or reliably in an email client.
- **No licence content-validation.** `licence` stays free text — this
  package has no authority over what licences a consumer's assets actually
  carry, unchanged from v1.
- **No automatic captioning/transcription.** A missing captions/transcript
  pair is a hard validation failure a human must resolve, never something
  this package infers or generates.
- **No video generation, transcoding, or poster extraction** — the
  identical "registry, not an engine" boundary this file's own top comment
  already draws for images.

## `document` — a product-neutral structured-document contract and renderer

A help article, a policy page, a changelog entry, a long-form explainer —
any page whose body is "read this document," not "fill in these five named
regions" — has no shape in `SurfaceSlotBinding` (a single `CopyRef` or a
caller-owned `node`, never an ordered sequence of headings, paragraphs,
lists, tables, and callouts). `@clossys/publisher/document` is that
shape: `StructuredDocument`, `validateStructuredDocument`, and
`renderStructuredDocument`.

```ts
import { validateStructuredDocument, renderStructuredDocument } from "@clossys/publisher/document";
import type { StructuredDocument } from "@clossys/publisher/document";

const ref = (id: string) => ({ id });

const helpArticle: StructuredDocument = {
  id: "acme.help.getting-started",
  title: ref("acme.doc.title"),
  sections: [
    {
      kind: "section",
      id: "overview", // a literal, author-supplied, locale-stable anchor — never derived from `heading`
      level: 2, // h1 is reserved for the page's own title, rendered outside this contract
      heading: ref("acme.overview.heading"),
      blocks: [
        {
          kind: "paragraph",
          content: [
            { kind: "text", text: ref("acme.overview.p1") },
            { kind: "link", text: ref("acme.overview.link"), href: "#pricing" }, // an in-document fragment link
          ],
        },
        { kind: "list", style: "ordered", items: [[{ kind: "text", text: ref("acme.overview.item1") }]] },
      ],
    },
    {
      kind: "section",
      id: "pricing",
      level: 2,
      heading: ref("acme.pricing.heading"),
      blocks: [{ kind: "table", headers: [ref("acme.pricing.plan"), ref("acme.pricing.price")], rows: [[ref("acme.pricing.plan1"), ref("acme.pricing.price1")]] }],
    },
  ],
};

const findings = validateStructuredDocument(helpArticle); // [] when clean — see "What is validated" below
const { element, resolutions } = renderStructuredDocument(helpArticle, { resolveCopyId: myCopyResolver });
```

**Every leaf of content is a `CopyRef`, never a literal string** — the same
discipline `SurfaceSlotBinding.copy` already holds document content to.
`DocumentBlock` is a closed, six-member vocabulary (`section`, `paragraph`,
`list`, `definition-list`, `table`, `callout`); `DocumentInline` (inside a
paragraph, list item, or callout — never a block on its own) is `text` or
`link`. A `DocumentSection` (`id`, `level: 2–6`, `heading`, `blocks`) is the
one block kind that nests, and is also what `StructuredDocument.sections`
is made of at the top level. See `src/document/types.ts` for the full
shape and every field's own doc comment.

**What is validated (`validateStructuredDocument(value): ComposeFinding[]`)**
— shape (every block/inline kind checked against its own fields, a
distinct `rule` name per failure, the same `{ rule, severity, message,
path }` shape every other validator in this package uses, attributed to a
precise path like `sections.0.blocks.2.rows.1`), plus four checks worth
calling out:

- **Heading order.** A top-level `sections` entry must be `level: 2`
  (`"section-level-must-be-two-at-top"`); a nested section's `level` must
  equal its parent's `+ 1` — never equal, lower, or skipped ahead
  (`"section-level-skip"`, the exact h2→h4 jump this contract exists to
  catch); a `level: 6` section may not contain a nested section, since
  there is no `level: 7` (`"section-level-max-depth"`).
- **Links.** A `"link"`'s `href` is checked against a closed scheme
  allowlist — `https:`, `http:`, `mailto:` — the same
  `protocol !== "https:" && protocol !== "http:"` shape
  `packages/auth/src/redirect.ts`'s `parseHttpUrl` already uses elsewhere
  in this repository, extended with `mailto:`. A rejected scheme
  (`javascript:`, `data:`, `file:`, or an unparseable value) is
  `"link-scheme-not-allowed"`, **an error finding, never a silent drop**:
  it is never omitted from the block, never replaced with a placeholder,
  and never rendered inert — the finding makes the whole document invalid,
  and `renderStructuredDocument` refuses to render at all.

  Two **schemeless** forms are accepted alongside those three schemes,
  because a prose document overwhelmingly links inside its own site:

  - A `"#fragment"` link skips the scheme check (there is no scheme) but
    must resolve against a real `DocumentSection.id` present anywhere in
    the same document, at any nesting depth — a fragment naming no such id
    is `"link-fragment-unresolved"`.
  - A **root-relative** `"/pricing"` is accepted as-is. It is same-origin
    by construction, so there is no scheme to allowlist, and requiring an
    absolute URL instead would bake the deployment's hostname into content
    the copy registry owns.

  Two forms that *look* relative are rejected, and the distinction is the
  point:

  - `"//host/path"` — **protocol-relative** — is
    `"link-protocol-relative"`. It reads as same-site and is not: it
    inherits only the scheme and resolves to whatever host follows the
    `//`. Write the absolute `https:` URL if that other origin is
    genuinely intended.
  - `"docs/foo"`, `"../sibling"` — **path-relative** — is
    `"link-scheme-not-allowed"`. It resolves against whichever route the
    document is mounted at, and this contract exists precisely so one
    `StructuredDocument` can be rendered in more than one place; a link
    that means different things per mount point is a defect that would
    only surface on the second mount.
- **Tables.** `headers` must be a non-empty `CopyRef[]`
  (`"table-headers-required"`); every row must have exactly
  `headers.length` cells, never padded or truncated
  (`"table-row-length-mismatch"`, reported per offending row index).
  `renderStructuredDocument` renders `headers` as `<th scope="col">` inside
  a `<thead>` and every row as `<td>` inside `<tbody>` — the header-to-cell
  association an accessible table needs is therefore structural (the fixed
  cell count matching a real `<th>` per column), not left to visual
  alignment.
- **Anchors.** Every `DocumentSection.id`, at every nesting depth, must be
  unique across the **whole document**, not just among siblings — a
  duplicate is `"section-anchor-duplicate"`, reported for the second (and
  every subsequent) occurrence, naming the path of the first. Never
  auto-renamed, suffixed, or dropped to force uniqueness — resolving the
  collision is the author's job.

An empty document (`sections: []`), an empty list (`items: []`), and an
empty table body (`rows: []`, headers still required) are each valid —
"empty is a fact to report, not to hide," the same discipline
`SurfaceRepeatingSlotBinding.items` already holds `surface/core` to —
never a special-cased finding.

**`renderStructuredDocument(doc, options?)` renders to semantic HTML only**
— `<section>`, `<h2>`–`<h6>`, `<p>`, `<ul>`/`<ol>`, `<dl>`, `<table>`/
`<thead>`/`<tbody>`/`<th>`/`<td>`, `<a>`, and `<aside role="note"
data-callout-tone="…">` for a callout (there is no single HTML element for
"callout"; `<aside>` is the closest semantic fit, and `data-callout-tone`
is this subpath's own public, documented attribute naming the closed
`tone` vocabulary — not an internal-convention leak). Every block and every
inline node is a typed primitive this renderer walks explicitly and emits
as a specific element: there is no `"html"` block kind, no markdown string
parsed into markup, and no `dangerouslySetInnerHTML` anywhere on this
path — the same non-goal issue #175 (the web-template registry) states for
its own `"node"`-kind slots, applied here to document content specifically.

It **refuses to render an invalid document at all**:
`validateStructuredDocument` runs first, and any `severity: "error"`
finding throws `RenderError("resolution-failed", ...)` before a single
element is built — reusing this package's existing closed
`RenderErrorReason` vocabulary (`src/internal/errors.ts`) rather than
inventing a parallel one, and never partially rendering a document with
known-invalid content. The same error, and the same reason, is thrown if a
`CopyRef` fails to resolve during rendering (no `options.resolveCopyId`
supplied, an unresolved id, or empty resolved text) — the identical
fail-closed shape `resolveSurfaceDocument` already uses for every other
unresolved/invalid input in this package.

`doc.title` is resolved (and appears in the returned `resolutions`, for
provenance) but is **never rendered into the output tree** — the page's
own `<h1>` stays the caller's job, the same discipline `ErrorView` already
holds between its own `<h1>` and `EmptyState`'s `<h2>`.

**`resolveCopyId`'s type, and the `{ element, resolutions }` return
shape.** `RenderStructuredDocumentOptions.resolveCopyId` is
`@clossys/writer`'s own ref-based `CopyResolver` —
`(ref: CopyRef) => CopyResolution | undefined`, the same type
`resolveSurfaceDocument`'s own `resolver` parameter takes — **not**
`surface/web`'s string-keyed `CopyResolver` (`(copyId: string) => string |
undefined`). Every `CopyRef` this render resolves (`title`, every
`heading`, every inline `text`/`link` text, every table header/cell, every
callout/definition-list text) is collected into a `CopyResolution[]`,
returned as `resolutions` alongside the rendered `element` — feed it to
`collectCopyProvenance` (`surface/core`) exactly as
`ResolvedSurfaceDocument.resolutions` already is.

**Plugging a rendered document into a page.** `renderStructuredDocument`'s
`element` is a plain `ReactNode` a consumer's own `surface/web` template
can accept through a `"node"`-kind slot (`defineWebTemplate`/
`createWebRenderer`, see "`defineWebTemplate` / `createWebRenderer`"
above) — the page shell (header, nav, footer) around the document body is
exactly the kind of thing a consumer's own template already provides, and
this package invents no second, parallel composition seam for document
content specifically:

```ts
import { createElement } from "react";
import { defineWebTemplate, createWebRenderer } from "@clossys/publisher/web";
import { resolveSurfaceDocument } from "@clossys/publisher/core";
import type { SurfaceDocument } from "@clossys/publisher/core";

const HelpArticleView = defineWebTemplate({
  name: "HelpArticleView",
  flow: { slots: [{ key: "heading", required: true }, { key: "body", required: true }] },
  slotKinds: { body: ["node"] },
  build: (content) => createElement("main", null, createElement("h1", null, content.heading), content.body),
});

const page: SurfaceDocument = {
  id: "acme.help.getting-started.page",
  channel: "web",
  template: "HelpArticleView",
  meta: { channel: "web", title: ref("acme.page.title"), description: ref("acme.page.title") },
  bindings: [
    { slot: "heading", copy: ref("acme.page.title") },
    { slot: "body", node: element as object }, // renderStructuredDocument's own `element`, from above
  ],
};

const resolved = resolveSurfaceDocument(page, myCopyResolver, { nodeSlots: ["body"] });
const { element: pageElement } = createWebRenderer({ templates: [HelpArticleView] }).renderWebDocument(resolved.document, { nodes: resolved.nodes });
```

**Non-goals** (see issue #176 for the fuller argument for each): no
legal-specific content types (no clause numbering, no defined-terms
glossary, no citation/footnote-to-statute primitive — this contract
describes document *structure*, never *what kind* of document it is); no
arbitrary HTML passthrough; no pagination (a `StructuredDocument` is one
document — a multi-page work is a caller-side concern composing an ordered
sequence of them, the identical boundary this package's README already
draws for `SurfaceDocument` and canvas channels); no automatic
table-of-contents generation (this contract supplies the addressable
section/anchor structure a TOC would be built from; generating and
rendering the TOC itself is left to the caller).

## `record` — the append-only publication ledger

`@clossys/publisher/record` is the return path: an append-only
record of what was published, to which channel, when, derived from which
revision of strategy, citing which facts — and a drift checker that answers
whether a cited fact still holds, without ever depending on
`@clossys/strategist`. It ships in the same install as the composer
half above — see "Why `publisher` is one package, not two," above — so there
is no separate `npm install` line here.

### Why this subpath exists

A prior, much larger attempt at this pipeline (strategy → brand → contracts
→ vocabulary → renderers, and a full measurement stack built alongside it)
never connected the two halves. That project's own `strategy` package
stated in its README and `package.json`, as policy: *"the arrow only goes
one way."* Grepping its entire measurement stack for the string `strategy`
returned **zero matches**. The rule itself is correct — brand must derive
from strategy, never the reverse, or the system launders opinion into fact
— but framing the *whole system* as a single arrow is why a return path was
never built at all. Nothing closed the loop from "we published this" back
to "does the thing we claimed still hold?"

The `record` subpath is that return path. Its discipline is the most important thing
about it, more than any function signature below:

> **It records what happened. It does not judge whether that was good.
> Nothing writes back automatically.**

Concretely:

- **This package does not depend on `@clossys/strategist`.** Every fact
  a `PublicationEntry` cites is a plain, opaque `factRef` string — the same
  seam `@clossys/writer/voice`'s `Claim.factRef`,
  `@clossys/writer`'s `CopyEntry.factRef`, and
  `@clossys/strategist`'s own `Market.factRefs`/`Audience.factRefs`
  already use one layer up. `@clossys/strategist` is not in this package's
  `dependencies`, and nothing in `src/` imports it. Resolving a `factRef`
  against a real fact registry — reading `@clossys/strategist`'s
  `readStrategy` bundle
  and reducing it to `{ [fact.key]: fact.value }` — is a caller's job,
  happening in code this package has no visibility into.
- **`checkLedgerDrift` has no opinion about whether an outcome is good.** There is no
  `score`, `threshold`, or `verdict` field on `PublicationEntry`, and no
  function here computes one. `checkLedgerDrift` answers exactly one
  question — has a cited fact's value changed since publication? — and
  stops there. Whether that drift matters, and what (if anything) to do
  about it, is a decision made by whatever reads this package's output,
  human or agent. This package supplies the evidence, never the verdict.
- **The loop closes through a decision, not an import.** Resist the pull
  toward "and then it could automatically…" — retract the page, alert
  strategy, open a ticket. That temptation is the exact failure this
  design exists to avoid: the moment `record` starts acting on drift
  instead of reporting it, it has quietly become a second, unaccountable
  strategy-setting mechanism.

### Usage

#### Recording a publication

```ts
import { appendEntry, citeFact, type Ledger, type PublicationEntry } from "@clossys/publisher/record";

let ledger: Ledger = [];

const entry: PublicationEntry = {
  id: "pricing-page-2026-08-07",
  publishedAt: new Date().toISOString(),
  channel: "web",
  url: "https://example.com/pricing",
  strategyRevision: "strategy@1.4.0",
  factCitations: [citeFact("active-customers", 4200)],
};

ledger = appendEntry(ledger, entry); // returns a NEW, deep-frozen ledger
```

#### Checking for drift

```ts
import { checkLedgerDrift } from "@clossys/publisher/record";
// readStrategy comes from @clossys/strategist — the caller's job, not this package's

const currentValues = { "active-customers": 5000 }; // read from the caller's own facts.json, not from this package

const report = checkLedgerDrift(ledger, currentValues);
if (!report.ok) {
  console.error(`Checked ${report.entriesChecked} entries, ${report.citationsChecked} citations: ${report.citationsDrifted} drifted.`);
  for (const f of report.findings) console.error(`[${f.severity}] ${f.rule}: ${f.message}`);
  process.exitCode = report.citationsDrifted > 0 ? 1 : 2;
}
```

Or from the shell, once built:

```bash
npx publisher-record-check ./ledger.json ./current-values.json
```

#### Guarding storage against a hand-edit

```ts
import { checkAppendOnly } from "@clossys/publisher/record";

const findings = checkAppendOnly(previousLedgerJson, nextLedgerJson); // e.g. base ref vs. head ref in a CI job
if (findings.length > 0) {
  for (const f of findings) console.error(`[${f.severity}] ${f.rule}: ${f.message}`);
  process.exitCode = 1;
}
```

Or from the shell, once built — the same `publisher-record-check` bin `checkLedgerDrift` uses, via its `append-only` subcommand:

```bash
npx publisher-record-check append-only ./previous-ledger.json ./next-ledger.json
```

### Why append-only

A ledger that can be silently edited after the fact is not evidence — it is
just another opinion with better formatting. This package enforces
append-only two ways, deliberately not one, because it owns no storage of
its own (see "Non-goals" below) and therefore cannot guarantee every write
goes through its own API:

1. **Structurally prevented, in process.** `appendEntry` is the only
   exported way to grow a `Ledger`. There is no `updateEntry` and no
   `removeEntry` anywhere in this package — not stubbed out, not marked
   deprecated, simply never written. `appendEntry` itself refuses (throws)
   to append an entry whose `id` already exists, so the one way this
   package's own API could be asked to "replace" an entry is refused
   outright. Every `Ledger` it returns, and every entry inside it, is
   deep-frozen — because this package ships ESM only (always strict mode),
   an attempt to mutate a returned entry throws a real `TypeError` rather
   than failing silently.
2. **Loudly rejected, at rest.** Nothing stops a ledger stored as, say, a
   JSON file checked into git from being hand-edited directly, bypassing
   `appendEntry` entirely. `checkAppendOnly` is built for exactly that gap:
   given two serialized snapshots of a ledger (a CI job's natural inputs
   are a base ref's copy and a head ref's copy), it fails loudly — a
   `LedgerFinding` per entry removed, reordered, or mutated — the moment
   `next` fails to be a pure, order-preserving superset of `previous`.

Chose **prevent** for in-memory use and **loudly reject** for at-rest use
because this package cannot own storage (see below) — there is no lock it
could hold on a consumer's git repository or database, only a check it can
run against whatever that storage produced.

### Why the drift checker fails closed

The whole point of `checkLedgerDrift` is answering "is this still true?"
honestly — and an honest answer requires being just as clear about *what
was not checked* as about what was. A checker that quietly narrows its own
coverage and reports the narrowed result as a clean pass is a check that
passes while asserting nothing, and this repository has hit that exact
failure mode before. `checkLedgerDrift`'s `DriftReport` always carries
`entriesChecked`/`citationsChecked`/`citationsUnchecked`/`citationsDrifted`
— never just a boolean — and `ok` is `false`, with an explicit finding, for
every one of these:

- The ledger itself does not validate (`"ledger-invalid"`).
- The ledger has zero entries (`"empty-ledger"`) — the literal "nothing to
  check" case.
- The ledger has entries, but zero of their citations end up compared to a
  current value — either every citation lacked a supplied current value,
  or no entry cited any fact at all (`"no-citations-checked"`). This is the
  harder case: a *non-empty* ledger that still verified nothing, and the
  one a naive `ok: citationsDrifted === 0` implementation would silently
  report as clean.

A citation with no current value supplied is still reported
(`"fact-unchecked"`, `"warning"`) but does not by itself flip `ok` to
`false` — a caller with partial `currentValues` coverage gets an honest
partial result, visible in the counts, not an all-or-nothing gate.

### Non-goals

- **No I/O.** Every function in this package — `validateEntry`,
  `validateLedger`, `canonicalizeValue`, `citeFact`, `appendEntry`,
  `checkAppendOnly`, `checkLedgerDrift` — is pure. This package does not
  read a file, does not know what a real ledger's storage looks like (a
  JSON file, a database row, a git-committed document), and does not
  decide where a `Ledger` lives long-term. Only `cli.ts` (not part of the
  library's exported surface — see the exports reference below) does any filesystem
  work, and only to read the two JSON files `publisher-record-check` is pointed at.
- **No fact registry.** This package never resolves a `factRef` against
  anything. It does not know what a real fact is, does not validate that a
  `factRef` names one that exists, and does not import
  `@clossys/strategist` to find out. See "Why this package exists"
  above.
- **No judgement.** `checkLedgerDrift` reports drift; it does not decide
  whether drift matters, does not retract anything, does not notify
  anyone, and does not write anything back to a ledger or to strategy. Any
  of those is a decision for the human or agent reading this package's
  output to make deliberately, not something this package should do on
  its own initiative.

### `record` — exports and the CLI

| Export | Kind | Purpose |
| --- | --- | --- |
| `PublicationEntry` | type | One append-only record: `id`, `publishedAt` (ISO 8601 instant), `channel` (a plain string — not `@clossys/publisher/core`'s closed `Channel` vocabulary; a real publication channel is broader than the composer half's five render targets), optional `url`, `strategyRevision` (an opaque string naming the revision of strategy this was derived from), `factCitations: FactCitation[]`, and an optional `contentBinding: PolicyBinding` committing to the published artifact's own bytes. No score, threshold, or verdict field — see "Why this package exists". |
| `FactCitation` | type | `{ factRef: string; valueBinding: PolicyBinding }` — one fact a `PublicationEntry` cites, bound to that fact's value at publication time. `factRef` is opaque, the same seam `@clossys/writer/voice`'s `Claim.factRef` uses. `valueBinding.policyId` always equals `factRef`, enforced by `validateEntry`'s `"citation-policy-id-mismatch"` rule and by construction in `citeFact`. |
| `Ledger` | type | `readonly PublicationEntry[]` — nothing more than an ordered, append-only list. |
| `LedgerFinding` | type | `{ rule, severity: "error" \| "warning", message, path? }` — this package's own finding shape, deliberately the same shape as `@clossys/controller/policy`'s `Finding` (kept as a separate local type, never pulled in from there) and every sibling `*Finding` type across this foundation. |
| `DriftReport` | type | What `checkLedgerDrift` returns: `ok`, `entriesChecked`, `citationsChecked`, `citationsUnchecked`, `citationsDrifted`, `findings: LedgerFinding[]`. See "Why the drift checker fails closed". |
| `PolicyBinding` | type | Re-exported directly from `@clossys/controller/policy`, unchanged, so a consumer never needs its own dependency on `policy` just to read the type `FactCitation.valueBinding`/`PublicationEntry.contentBinding` return. |
| `DigestAlgorithm` | type | Re-exported from `@clossys/controller/policy` — currently just `"sha256"`. |
| `PolicyFinding` | type | `@clossys/controller/policy`'s own `Finding` type, re-exported under a name that does not collide with this package's own `LedgerFinding` when both are named in one statement. |
| `validateEntry(value, path?)` | function | Structural validation of a single `PublicationEntry`: is `id`/`channel`/`strategyRevision` a non-empty string, is `publishedAt` a full ISO 8601 UTC instant, is `url` (when present) a parseable URL, is every `factCitations[i]` a well-formed `FactCitation` (delegating the `valueBinding` shape check to `@clossys/controller/policy`'s own `validateBindingShape`), is `contentBinding` (when present) a well-formed `PolicyBinding`. Returns `LedgerFinding[]`; empty means valid. Never throws. |
| `validateLedger(value)` | function | Validates a whole `Ledger`: must be an array, every element must pass `validateEntry`, every `id` must be unique across the array (`"duplicate-entry-id"` — what an attempted overwrite looks like when it bypasses `appendEntry`). An empty array is a valid *shape* — `validateLedger([])` returns `[]`; `checkLedgerDrift` is what treats an empty ledger as a failure, since "is this ledger well-formed" and "did this check verify anything" are different questions. |
| `canonicalizeValue(value)` | function | Deterministically stringifies a JSON-serializable `value` (string, finite number, boolean, `null`, plain object, array — recursively) so that structurally equal values always canonicalize identically regardless of object-key order. Used by `citeFact` (to digest a fact's value) and `checkAppendOnly` (to compare two entries for real content equality, not just reference equality). Throws on a non-finite number, a function, or a `Symbol` — a producer-side error, the same precedent `@clossys/controller/policy`'s `computeDigest` sets for an unsupported algorithm. |
| `citeFact(factRef, value, algorithm?)` | function | Builds a `FactCitation`: computes `canonicalizeValue(value)`'s digest under `algorithm` (default `"sha256"`) via `@clossys/controller/policy`'s own `computeDigest`, and returns `{ factRef, valueBinding: { policyId: factRef, digestAlgorithm, digest } }`. This package's first real use of `@clossys/controller/policy` outside `policy` itself. Throws on an empty `factRef` or a `value` `canonicalizeValue` cannot handle. |
| `appendEntry(ledger, entry)` | function | The one sanctioned way to grow a `Ledger`. Throws (never returns a `LedgerFinding[]`) on a malformed `entry` or an `entry.id` that already exists in `ledger` — both are caller programming errors at the point of the call, the same distinction `computeDigest` draws. Returns a **new**, deep-frozen `Ledger`; `ledger` itself, and every entry already in it, is left completely untouched. |
| `checkAppendOnly(previous, next)` | function | The at-rest complement to `appendEntry`. Pure diff between two `unknown` values, each validated with `validateLedger` first. Reports `"entry-removed"`, `"entry-reordered"`, or `"entry-mutated"` (compared via `canonicalizeValue`, so a harmless JSON-key-order round-trip is never mistaken for a real change) for anything in `previous` that `next` fails to preserve exactly, in the same position; `"entries-removed"` once, up front, if `next` has fewer entries than `previous`. An empty return means `next` is a valid append-only evolution of `previous`. |
| `checkLedgerDrift(ledger, currentValues)` | function | The drift checker: for each `FactCitation` in `ledger`, compares its recorded `valueBinding` against `currentValues[citation.factRef]` (canonicalized, then run through `@clossys/controller/policy`'s own `verifyBinding` — no digest-comparison logic reimplemented here) and reports a `"fact-drift"` finding on mismatch. `currentValues` is a plain `factRef -> value` map — this function never reads a real fact registry or depends on `@clossys/strategist`. Fails closed on an invalid ledger, an empty ledger, or a non-empty ledger where nothing ends up checked — see "Why the drift checker fails closed". |
| `JoinKeyReport` | type | What `checkJoinKeyCompleteness` returns: `ok`, `liveEntriesChecked`, `completeLiveEntries`, `incompleteLiveEntries`, `identities: JoinKeyIdentity[]`, `findings: LedgerFinding[]`. Mirrors `DriftReport`'s counted shape for the same reason — "checked nothing" and "checked everything and it held" must never print as the same result. |
| `JoinKeyIdentity` | type | `{ contentId: string; windows: Array<{ entryId, publishedAt, supersededAt? }> }` — one content identity with every window it has been published under, in `publishedAt` order. Exposed on the report so a caller can assert on the grouping directly rather than infer it from a pass or fail. |
| `checkJoinKeyCompleteness(ledger)` | function | For everything the ledger currently says is live, is enough recorded here for someone else — an observer-shaped tier holding external engagement signals, never this package — to attribute a signal to the right revision of the right surface? Reports `"join-key-missing-identity"` (a live entry with no `contentId`), `"join-key-window-invalid"` (a `supersededAt` that does not actually close a window), and the cross-entry `"join-key-identity-churn"`. Emits and checks for a KEY only, never a verdict about whether a signal is good — see "Why this package exists". Fails closed on an invalid ledger, an empty ledger, or a ledger with zero live entries. |

`publisher-record-check` (the CLI, installed as a `bin` when this package is
installed — its argv-handling `cli.ts` is deliberately not part of the
exports above, the same convention `@clossys/strategist`'s
`strategist-check` and `@clossys/writer`'s `writer-check` already
set) has two invocations, dispatched on the literal first `argv` token —
never on the invoked binary's path or filename, since this repository
always invokes a gate by its compiled path (`node .../dist/cli.js`), and a
filename-keyed dispatch would always see `cli.js`:

The default (no subcommand) invocation reads a ledger JSON file and a
current-values JSON file, runs `checkLedgerDrift`, and prints a report:

```bash
npx publisher-record-check ./ledger.json ./current-values.json
```

Exit codes: `0` clean (something was checked, nothing drifted), `1` at
least one cited fact has drifted, `2` could not run — bad arguments, a file
missing/unreadable/not valid JSON, an invalid or empty ledger, or a ledger
whose citations could not be compared against any current value. `1` and
`2` are kept strictly distinct on purpose: "found a real problem" and
"could not check" must never look like the same failure to a CI job
branching on the exit code.

The **`append-only` subcommand** reads two ledger JSON files — a
`previous` and a `next`, e.g. a base ref's copy and a head ref's copy in a
CI job — and runs `checkAppendOnly`:

```bash
npx publisher-record-check append-only ./previous-ledger.json ./next-ledger.json
```

Exit codes follow the same three-state shape: `0` — `next` verified as a
valid, order-preserving append-only evolution of `previous`, over at least
one entry in `previous`; `1` — a real violation (an entry in `previous` was
removed, reordered, or mutated in `next`); `2` — could not evaluate — bad
arguments, a file missing/unreadable/not valid JSON, either ledger failing
its own shape validation, or `previous` having zero entries. Zero entries
is deliberately its own `2`, not folded into `0`: `checkAppendOnly` reports
no findings at all for an empty `previous` (there is nothing in it that
could have been altered), so the CLI checks `previous`'s entry count itself
rather than treating "no findings" alone as proof anything was verified —
"checked nothing" and "checked everything and it held" must stay
distinguishable, the same discipline `checkLedgerDrift`'s empty-ledger case
already holds this CLI to above.

The **`join-key` subcommand** reads one ledger JSON file and runs
`checkJoinKeyCompleteness`:

```bash
npx publisher-record-check join-key ./ledger.json
```

Exit codes, same three-state shape again: `0` — every currently-live entry
carries a complete join key, verified over at least one live entry; `1` — a
live entry is missing its content identity or its window is not
interpretable, or two entries at the same address disagree on identity; `2`
— could not evaluate: bad arguments, a file missing/unreadable/not valid
JSON, an invalid or empty ledger, or **zero entries currently live**. That
last case is deliberately a `2` rather than a `0`, for the same reason
`append-only`'s empty-`previous` case is: a ledger that has retired
everything it ever recorded produces no findings, and "nothing live to
check" must never read as "publishing here is cleanly governed".

Liveness is derived, not read off a field. This package is append-only, so
an already-recorded entry can never be reached back into and marked no
longer current once a successor ships; `supersededAt` is therefore often
absent even on an entry that is, in fact, retired. Entries are grouped by
`contentId`, the latest `publishedAt` in each group is the live candidate,
and it stays live unless it carries a well-formed `supersededAt` strictly
after its own `publishedAt`. An entry with no `contentId` cannot be grouped
against anything, so it is always treated as live — the same fail-closed
choice `checkLedgerDrift` makes for a citation it could not check.

## API

- `core`: `CHANNELS`, `ELEMENT_KINDS`, `validateComposeDocument`,
  `validateSurfaceDocument`, `isSurfaceRepeatingSlotBinding`,
  `createOutputManifest`,
  `collectCopyProvenance`, `createResolvedOutputManifest`,
  `resolveSurfaceDocument`, `validateSectionedViewDocument`,
  `resolveSectionedViewDocument`,
  `resolveDocument`, `resolveCopy`, `resolveAssets`, `frameToInches`,
  `frameToPercent`, `getSlotSpec`, `listSlotKeys`, `requiredSlotKeys`, and
  the `Channel`, `ChannelMeta`, `ComposeDocument`, `ComposeFinding`,
  `ElementKind`, `EmailMeta`, `FlowLayoutSpec`, `FlowSlotSpec`, `Frame`, `ImageMeta`, `LayoutSpec`,
  `PrintMeta`, `Rect`, `ResolvedSlot`, `ResolveResult`, `SlidesMeta`,
  `SlotBinding`, `SlotSpec`, `StyleBinding`, `SurfaceDocument`,
  `SurfaceBinding`, `SurfaceSlotBinding`, `SurfaceRepeatingSlotBinding`,
  `SurfaceRepeatingSlotFieldBinding`, `SurfaceSlotBindingItem`, `SurfaceChannelMeta`, `OutputArtifact`,
  `OutputManifest`, `StrategyProvenance`, `CopyProvenance`, `WebMeta`, `CopyLookup`,
  `CopyResolveResult`, `ResolvedText`, `AssetLookup`, `AssetResolveResult`,
  `ResolvedAsset`, `ResolvedSurfaceDocument`, `ResolvedSurfaceGroup`,
  `ResolvedSurfaceGroupField`, `ResolvedSurfaceGroupItem`, `ResolvedSurfaceNode`,
  `ResolveSurfaceDocumentOptions`, `SurfaceResolutionReason`, and
  `CanvasInches`, `SectionedViewDocument`, `SectionedViewSection`,
  `SectionedViewSectionKind`, `SectionedViewGround`, `SectionedViewHeroSection`,
  `SectionedViewFeatureGridSection`, `SectionedViewFeatureItem`, `SectionedViewFaqSection`,
  `SectionedViewFaqItem`, `SectionedViewOrderedStepSequenceSection`,
  `SectionedViewOrderedStep`, `SectionedViewStatusListSection`,
  `SectionedViewStatusGroup`, `SectionedViewStatusItem`, `SectionedViewStatus`,
  `ResolvedSectionedViewDocument`, `ResolvedSectionedViewSection`, and
  `SectionedViewResolutionReason` types. `SurfaceResolutionError` and
  `SectionedViewResolutionError` are thrown when their canonical resolution
  paths fail closed.
- `media`: `parseAssetRecord`, `validateAssetRecordShape`,
  `readAssetRecord`, `checkAssetCoverage`, and the `AssetEntry`,
  `AssetEntryId`, `AssetFinding`, `AssetRecord`, `AssetRegistryReadIssue`,
  `AssetRegistryReadIssueReason`, `AssetRegistryReadResult`,
  `AssetCoverageReport`, `AssetTypeCounts`, `ImageAssetEntry`,
  `ImageSource`, `VideoAssetEntry`, `VideoCaption`, and
  `VideoReducedMotionBehavior` types. The CLI is `publisher-media-check`.
- `web`: `renderWebDocument`, `buildWebHeadMetadata`,
  `listWebTemplateNames`, `defineWebTemplate`, `createWebRenderer`,
  `AuthView`, `CaptureView`, `CollectionView`, `DocumentView`, `ErrorView`,
  `MarketingView`, `RenderError`, and the `AuthViewProps`,
  `CaptureViewProps`, `CollectionViewEmptyState`, `CollectionViewEntry`,
  `CollectionViewLink`, `CollectionViewPagination`, `CollectionViewProps`,
  `DocumentViewEffectiveDate`, `DocumentViewProps`,
  `ErrorViewProps`, `MarketingViewProps`, `MarketingFeatureItem`, `MarketingFaqItem`,
  `RenderErrorReason`, `AssetResolver`, `CopyResolver`, `RenderWebOptions`,
  `RenderWebResult`, `RepeatingWebSlotFieldSpec`, `RepeatingWebSlotSpec`, `ResolvedWebGroupField`, `ResolvedWebGroupItem`,
  `WebSlotContentKind`, `WebTemplate`, `DefineWebTemplateOptions`,
  `CreateWebRendererOptions`, `WebRenderer`, `WebHeadMetadata`,
  `WebOpenGraphMetadata`, and `WebTwitterMetadata` types.
- `document`: `validateStructuredDocument`, `renderStructuredDocument`,
  `RenderError`, and the `DocumentBlock`, `DocumentCallout`,
  `DocumentDefinitionList`, `DocumentInline`, `DocumentList`,
  `DocumentParagraph`, `DocumentSection`, `DocumentTable`,
  `StructuredDocument`, `RenderStructuredDocumentOptions`,
  `RenderStructuredDocumentResult`, and `RenderErrorReason` types.
- `email`: `renderEmailDocument`, `RenderError`, and the
  `RenderErrorReason`, `EmailRenderResult`, `RenderEmailOptions`, and
  `RenderWarning` types.
- `print`: `renderPrintDocument`, `RenderError`, and the
  `RenderErrorReason`, `CopyResolver`, `CustomPageSize`, `PrintPageInfo`,
  `RenderPrintOptions`, and `RenderPrintResult` types.
- `image`: `renderImageDocument`, `RenderError`, `computeCanvasDimensions`,
  `escapeXml`, `frameToCanvasRect`, `resolveColorRole`, `wrapText`, and the
  `RenderErrorReason`, `RenderImageOptions`, `RenderImageResult`,
  `CanvasDimensions`, `CanvasPixelSize`, `PixelRect`, `TextWrapOptions`, and
  `TextWrapResult` types.
- `slides`: `renderSlidesDeck`, `canvasForAspect`, `RenderError`, and the
  `RenderErrorReason`, `RenderedSlide`, `RenderSlidesOptions`,
  `RenderSlidesResult`, and `SlidesDeckInput` types.
- `record`: see "`record` — exports and the CLI," above, for the full
  reference table. Summary: `validateEntry`, `validateLedger`,
  `canonicalizeValue`, `citeFact`, `appendEntry`, `checkAppendOnly`,
  `checkLedgerDrift`, `checkJoinKeyCompleteness`, and the `PublicationEntry`,
  `FactCitation`, `Ledger`, `LedgerFinding`, `DriftReport`, `JoinKeyReport`,
  `JoinKeyIdentity` types, plus `PolicyBinding`/`DigestAlgorithm`/
  `PolicyFinding` re-exported from `@clossys/controller/policy`. The
  CLI is `publisher-record-check`.

Web page-level compositions belong here, not in `designer`; they consume
design-system primitives and accept consumer-owned copy through slots.
Generated HTML, SVG, and other files are build artifacts owned by the
consumer, while this package owns the contracts and deterministic renderers
that produce them. `record` composes with none of it: see "`record` — the
append-only publication ledger," above, for why the two halves stay
import-free of each other under one version.

## Requirements and version coupling

Node 20+. This package's own `package.json` declares runtime dependencies on
`@clossys/writer` (`^0.3.0`), `@clossys/designer`
(`^0.2.6`), and `@clossys/controller` (`~0.8.0`) — of which this
package only imports the `./policy` subpath, `@clossys/controller/policy`,
never `controller`'s other exports. `writer` and `designer` are caret
ranges (both fresh `0.x` role packages); `controller` stays a tilde range,
deliberately not a caret — a caret range on a `0.x` package is patch-only
under semver and has broken this repository's CI before. Every declared
range is a real constraint on the dependency graph, not an install-ordering
concern: a package manager resolves the whole graph regardless of what order
packages are requested in, so none of this can be worked around by
installing things in a particular sequence. `writer`'s range first moved
from `^0.1.0` to `^0.2.0` when `writer` 0.2.0 changed `writer-check
addressability`'s exit-code precedence (issue #407), then to the current
`^0.3.0` when Writer added its passage layer (issue #373). Both were
additive or behavioural minor releases rather than patches, so the older
ranges do not resolve them (0.x ranges are minor-locked). `designer`'s range
first moved from `^0.1.0` to `^0.2.0` when Designer added the
`designer-environment-check` gate (issue #405), then tightened to the current
`^0.2.6` because Publisher's React-server target imports the server-safe
section-ground, `Faq`, ordered-step, and status-list exports introduced in
Designer 0.2.6. These ranges are independent; leaving
either one behind would still resolve an older package without any install
failure, silently withholding a required contract.

A consumer whose own policy is to pin exact versions must pin `writer` to a
matching `0.3.x` release, `designer` to `0.2.6` or a later compatible `0.2.x`
release, and
`controller` to a matching `0.8.x` patch release — otherwise
`publisher`'s declared ranges and the consumer's exact pin cannot both be
satisfied, and the install fails with an unresolvable version conflict.
`react` and `react-dom` are optional peer dependencies (`>=18`) required only
by the `web` and `document` subpaths' renderers. The `web` subpath also imports
Designer surfaces, so Publisher directly repeats Designer's optional
`@internationalized/date`, `react-aria-components`, `tailwind-merge`, and
`tailwindcss` peer ranges. This closes the public npm consumer graph instead
of relying on an installer to propagate a dependency's optional peers.
`record` has no peer dependencies of its own.

Marking `react` optional means npm gives no install-time signal if it's
missing or on an incompatible version — importing `./web` or `./document`
now guards against both itself: `renderWebDocument` and
`renderStructuredDocument` each throw a named error (never a silent pass)
stating whether `react` is absent entirely or installed but outside this
package's declared `>=18` range, before `createElement` itself gets a
chance to fail with a less legible error. `react-dom` has no guard of its
own — no file in this package ever imports it directly; only your own
`react-dom/server` or client render call does, downstream of the element
either renderer returns. See `src/internal/peer-version.ts` for the
guard's own contract.

All six peers remain `optional: true` in `peerDependenciesMeta`, correctly
reflecting that `./core`, `./media`, `./email`, `./print`, `./image`,
`./slides`, and `./record` do not need them. A consumer of `./web` must install
the declared peers at compatible versions; the release qualification adapter
does so explicitly and proves both the ordinary and `react-server` entry
points from a clean public-registry install. Historical GitHub Packages
metadata omitted `peerDependenciesMeta`; see
[issue #226](https://github.com/clossys/foundry/issues/226) for that retired
registry behavior.

## Licence

MIT
