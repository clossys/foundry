# @vespeneventures/surface

`@vespeneventures/surface` is the release unit for composed, audience-facing
surfaces and their rendered artifacts.

## Public entry points

Use explicit subpaths:

- `@vespeneventures/surface/core` — canonical `SurfaceDocument` contract, validation, copy/media resolution, and output manifests.
- `@vespeneventures/surface/media` — media registry, reader, and coverage check.
- `@vespeneventures/surface/web` — web composition and head metadata.
- `@vespeneventures/surface/email`, `/print`, `/image`, `/slides` — channel renderers.

The package has no root export. `core` is deliberately framework-agnostic;
the web subpath has optional React and UI peers, while non-web renderers do not
require them at runtime.

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
  `ResolvedSurfaceGroupItem`, `SurfaceResolutionReason`, and
  `CanvasInches` types. `SurfaceResolutionError` is thrown when canonical
  resolution fails closed.
- `media`: `parseAssetRecord`, `validateAssetRecordShape`,
  `readAssetRecord`, `checkAssetCoverage`, and the `AssetEntry`,
  `AssetEntryId`, `AssetFinding`, `AssetRecord`, `AssetRegistryReadIssue`,
  `AssetRegistryReadIssueReason`, `AssetRegistryReadResult`, and
  `AssetCoverageReport` types. The CLI is `surface-media-check`.
- `web`: `renderWebDocument`, `buildWebHeadMetadata`,
  `listWebTemplateNames`, `AuthView`, `ErrorView`, `MarketingView`,
  `RenderError`, and the `AuthViewProps`, `ErrorViewProps`,
  `MarketingViewProps`, `MarketingFeatureItem`, `MarketingFaqItem`,
  `RenderErrorReason`, `AssetResolver`, `CopyResolver`, `RenderWebOptions`,
  `RenderWebResult`, `WebHeadMetadata`, `WebOpenGraphMetadata`, and
  `WebTwitterMetadata` types.
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
`@vespeneventures/copy` (`~0.6.0`) and `@vespeneventures/ui` (`~0.11.0`) —
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
required only by the `web` subpath's renderers.

Marking `react` optional means npm gives no install-time signal if it's
missing or on an incompatible version — importing `./web` now guards
against both itself: `renderWebDocument` throws a named error (never a
silent pass) stating whether `react` is absent entirely or installed but
outside this package's declared `>=18` range, before `createElement`
itself gets a chance to fail with a less legible error. `react-dom` has no
guard of its own — no file in this package ever imports it directly; only
your own `react-dom/server` or client render call does, downstream of the
element `renderWebDocument` returns. See `src/internal/peer-version.ts`
for the guard's own contract.
