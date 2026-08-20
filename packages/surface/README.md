# @vespeneventures/surface

`@vespeneventures/surface` is the release unit for composed, audience-facing
surfaces and their rendered artifacts.

## Public entry points

Use explicit subpaths:

- `@vespeneventures/surface/core` — canonical `SurfaceDocument` contract, validation, copy/media resolution, and output manifests.
- `@vespeneventures/surface/media` — media registry, reader, and coverage check.
- `@vespeneventures/surface/web` — web composition and head metadata.
- `@vespeneventures/surface/document` — the product-neutral structured-document contract (sections, paragraphs, lists, tables, callouts, safe links) and its renderer.
- `@vespeneventures/surface/email`, `/print`, `/image`, `/slides` — channel renderers.

The package has no root export. `core` is deliberately framework-agnostic;
the web and document subpaths have optional React (and, for `web`, UI) peers,
while non-web renderers do not require them at runtime.

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
discipline a single binding does:

```ts
import type { SurfaceDocument } from "@vespeneventures/surface/core";

const acmeCapabilities: SurfaceDocument["bindings"][number] = {
  slot: "capabilities",
  items: [
    { copy: { id: "acme.capability.one" } },
    { copy: { id: "acme.capability.two" } },
    { assetId: "acme.capability.icon.three" },
  ],
};
```

`items` may be an empty array. That is a deliberate choice, not an
oversight: this package cannot tell "the consumer configured zero of these
on purpose" (a legitimately-empty testimonial list) apart from "something
upstream failed to populate this," so it validates an explicit `items: []`
as clean rather than guessing. See `types.ts`'s `SurfaceRepeatingSlotBinding`
doc comment for the fuller reasoning.

`resolveSurfaceDocument` resolves a repeating binding's items in order and
returns them on `ResolvedSurfaceDocument.groups` — an array of
`{ slot, items: [{ index, value? , node?, assetId? }, ...] }` — rather than
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
not just per slot — see `output-manifest.ts`.

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
`@vespeneventures/ui`'s `FeatureGrid`/`Faq` blocks respectively. An empty
repeating group (`items: []`) renders that section with zero entries —
never an error, the same "empty is a deliberate, valid choice" contract
`SurfaceRepeatingSlotBinding` itself holds to, above; a `faq` binding that
was never authored at all omits the whole FAQ section instead, which is a
different, equally valid outcome (see `MarketingView`'s own `faq` prop doc
comment).

Because one repeating item carries exactly one resolved value
(`copy`/`node`/`assetId`) but a FAQ entry needs two independent ones
(`question` and `answer`), a `faq` item must be authored via `node`,
shaped `{ question, answer }` — the same "explicit escape hatch for
content plain text cannot carry" `node` already is everywhere else in this
package. A `faq` item authored via `copy`/`assetId` instead fails closed
with `RenderError("empty-output", ...)`.

```ts
import type { SurfaceDocument } from "@vespeneventures/surface/core";
import { resolveSurfaceDocument } from "@vespeneventures/surface/core";
import { renderWebDocument } from "@vespeneventures/surface/web";

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
    // A repeating slot — one CopyRef per placeholder feature, in order.
    {
      slot: "features",
      items: [
        { copy: ref("acme.feature.one") },
        { copy: ref("acme.feature.two") },
        { copy: ref("acme.feature.three") },
      ],
    },
  ],
};

const resolved = resolveSurfaceDocument(acmeMarketingHome, myCopyResolver);
const { element, head } = renderWebDocument(resolved.document, {
  groups: resolved.groups, // carries "features" (and, if authored, "faq")
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
import type { SurfaceDocument } from "@vespeneventures/surface/core";
import { resolveSurfaceDocument } from "@vespeneventures/surface/core";
import { createWebRenderer, defineWebTemplate } from "@vespeneventures/surface/web";
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
`@vespeneventures/ui` atoms, a small caller-authored component. It never
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
this package never imports or depends on the strategy package.

The package test suite includes a product-neutral reference pipeline fixture:
an approved, versioned `CopyRegistry` resolves all content; flowed web/email
slots avoid canvas placeholders; web, email, image, print, and slide outputs
each receive a manifest with structural strategy provenance. It also asserts
that draft or malformed sources fail closed.

## `media` — the asset registry contract, responsive images, and video (v2)

`@vespeneventures/surface/media` registers a consumer's own image and video
assets under a stable `assetId`, the identical role `@vespeneventures/copy`
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
lists, tables, and callouts). `@vespeneventures/surface/document` is that
shape: `StructuredDocument`, `validateStructuredDocument`, and
`renderStructuredDocument`.

```ts
import { validateStructuredDocument, renderStructuredDocument } from "@vespeneventures/surface/document";
import type { StructuredDocument } from "@vespeneventures/surface/document";

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
`@vespeneventures/copy`'s own ref-based `CopyResolver` —
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
import { defineWebTemplate, createWebRenderer } from "@vespeneventures/surface/web";
import { resolveSurfaceDocument } from "@vespeneventures/surface/core";
import type { SurfaceDocument } from "@vespeneventures/surface/core";

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

## API

- `core`: `CHANNELS`, `ELEMENT_KINDS`, `validateComposeDocument`,
  `validateSurfaceDocument`, `isSurfaceRepeatingSlotBinding`,
  `createOutputManifest`,
  `collectCopyProvenance`, `createResolvedOutputManifest`,
  `resolveSurfaceDocument`,
  `resolveDocument`, `resolveCopy`, `resolveAssets`, `frameToInches`,
  `frameToPercent`, `getSlotSpec`, `listSlotKeys`, `requiredSlotKeys`, and
  the `Channel`, `ChannelMeta`, `ComposeDocument`, `ComposeFinding`,
  `ElementKind`, `EmailMeta`, `FlowLayoutSpec`, `FlowSlotSpec`, `Frame`, `ImageMeta`, `LayoutSpec`,
  `PrintMeta`, `Rect`, `ResolvedSlot`, `ResolveResult`, `SlidesMeta`,
  `SlotBinding`, `SlotSpec`, `StyleBinding`, `SurfaceDocument`,
  `SurfaceBinding`, `SurfaceSlotBinding`, `SurfaceRepeatingSlotBinding`,
  `SurfaceSlotBindingItem`, `SurfaceChannelMeta`, `OutputArtifact`,
  `OutputManifest`, `StrategyProvenance`, `CopyProvenance`, `WebMeta`, `CopyLookup`,
  `CopyResolveResult`, `ResolvedText`, `AssetLookup`, `AssetResolveResult`,
  `ResolvedAsset`, `ResolvedSurfaceDocument`, `ResolvedSurfaceGroup`,
  `ResolvedSurfaceGroupItem`, `ResolvedSurfaceNode`,
  `ResolveSurfaceDocumentOptions`, `SurfaceResolutionReason`, and
  `CanvasInches` types. `SurfaceResolutionError` is thrown when canonical
  resolution fails closed.
- `media`: `parseAssetRecord`, `validateAssetRecordShape`,
  `readAssetRecord`, `checkAssetCoverage`, and the `AssetEntry`,
  `AssetEntryId`, `AssetFinding`, `AssetRecord`, `AssetRegistryReadIssue`,
  `AssetRegistryReadIssueReason`, `AssetRegistryReadResult`,
  `AssetCoverageReport`, `AssetTypeCounts`, `ImageAssetEntry`,
  `ImageSource`, `VideoAssetEntry`, `VideoCaption`, and
  `VideoReducedMotionBehavior` types. The CLI is `surface-media-check`.
- `web`: `renderWebDocument`, `buildWebHeadMetadata`,
  `listWebTemplateNames`, `defineWebTemplate`, `createWebRenderer`,
  `AuthView`, `ErrorView`, `MarketingView`,
  `RenderError`, and the `AuthViewProps`, `ErrorViewProps`,
  `MarketingViewProps`, `MarketingFeatureItem`, `MarketingFaqItem`,
  `RenderErrorReason`, `AssetResolver`, `CopyResolver`, `RenderWebOptions`,
  `RenderWebResult`, `RepeatingWebSlotSpec`, `ResolvedWebGroupItem`,
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

Web page-level compositions belong here, not in `ui`; they consume UI
primitives and accept consumer-owned copy through slots. Generated HTML,
SVG, and other files are build artifacts owned by the consumer, while this
package owns the contracts and deterministic renderers that produce them.

## Requirements and version coupling

Node 20+. This package's own `package.json` declares runtime dependencies on
`@vespeneventures/copy` (`~0.9.0`) and `@vespeneventures/ui` (`~0.14.0`) —
patch-only tilde ranges, not exact pins. That is a real constraint on the
dependency graph, not an install-ordering concern: a package manager
resolves the whole graph regardless of what order packages are requested
in, so this cannot be worked around by installing things in a particular
sequence.

A consumer whose own policy is to pin exact versions must pin `copy` to a
matching `0.5.x` patch release and `ui` to a matching `0.10.x` patch release
— otherwise `surface`'s declared ranges and the consumer's exact pin cannot
both be satisfied, and the install fails with an unresolvable version
conflict. `react` and `react-dom` are optional peer dependencies (`>=18`)
required only by the `web` and `document` subpaths' renderers.

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

**Registry note: `react` and `react-dom` install even for a consumer using
only the non-web renderers.** Both are declared `optional: true` in
`peerDependenciesMeta`, correctly reflecting that `./core`, `./media`,
`./email`, `./print`, `./image`, and `./slides` need neither. That
declaration does not reach an installer resolving against
`npm.pkg.github.com`: the registry's packument omits
`peerDependenciesMeta` entirely, so both peers resolve as required
regardless of which subpaths are actually imported. A consumer rendering
only email or print output still has React and React DOM installed. This
package's own `dependencies` on `@vespeneventures/ui` (`~0.14.0`) compounds
it one level further: `ui` declares six of its own optional peers the same
way, and the same registry gap applies to them too, so a consumer of
`surface` inherits `ui`'s full peer set through the same mechanism, not just
`surface`'s own two. See
[issue #226](https://github.com/vespeneventures/foundry/issues/226) for the
full evidence and why the declarations stay as-is.
