# @vespeneventures/surface

`@vespeneventures/surface` is the release unit for composed, audience-facing
surfaces and their rendered artifacts.

Use explicit subpaths:

- `@vespeneventures/surface/core` — canonical `SurfaceDocument` contract, validation, copy/media resolution, and output manifests.
- `@vespeneventures/surface/media` — media registry, reader, and coverage check.
- `@vespeneventures/surface/web` — web composition and head metadata.
- `@vespeneventures/surface/email`, `/print`, `/image`, `/slides` — channel renderers.

The package has no root export. `core` is deliberately framework-agnostic;
the web subpath has optional React and UI peers, while non-web renderers do not
require them at runtime.

## SurfaceDocument migration

`SurfaceDocument` is the canonical authored contract. It replaces the
string-bearing `ComposeDocument` with `CopyRef` values for audience-facing
slots and metadata: web titles/descriptions, email subjects/preheaders, image
alt text, and slide notes. A binding is exactly one of `copy`, `node`, or
`assetId`; `node` preserves an explicit consumer-provided interactive/rich UI
node without pretending it is copy. `ComposeDocument` and its renderers remain
available as a deprecated compatibility path for this release.

Use `migrateComposeDocument(document, copyRefForLiteral)` to mechanically
preserve existing ids and convert legacy literals through your copy registry.
Use `resolveSurfaceDocument(surface, copyResolver)` at render time: it
validates the canonical document, resolves every required `CopyRef` against a
real approved registry, returns renderer-compatible data plus the full
resolution provenance, and fails closed for invalid, missing, or unsupported
node bindings.

Web and email templates use `FlowLayoutSpec`, which contains ordered keys and
requiredness only. Print, slides, and image surfaces use `CanvasLayoutSpec`
with frames and element kinds. This prevents flowed surfaces from carrying
fictional canvas geometry.

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
  `validateSurfaceDocument`, `createOutputManifest`,
  `collectCopyProvenance`, `createResolvedOutputManifest`,
  `resolveSurfaceDocument`,
  `migrateComposeDocument`, `resolveDocument`, `resolveCopy`, `resolveAssets`, `frameToInches`,
  `frameToPercent`, `getSlotSpec`, `listSlotKeys`, `requiredSlotKeys`, and
  the `Channel`, `ChannelMeta`, `ComposeDocument`, `ComposeFinding`,
  `ElementKind`, `EmailMeta`, `FlowLayoutSpec`, `FlowSlotSpec`, `Frame`, `ImageMeta`, `LayoutSpec`,
  `PrintMeta`, `Rect`, `ResolvedSlot`, `ResolveResult`, `SlidesMeta`,
  `SlotBinding`, `SlotSpec`, `StyleBinding`, `SurfaceDocument`, `SurfaceSlotBinding`, `SurfaceChannelMeta`, `OutputArtifact`, `OutputManifest`, `StrategyProvenance`, `CopyProvenance`, `WebMeta`, `CopyLookup`,
  `CopyResolveResult`, `ResolvedText`, `AssetLookup`, `AssetResolveResult`,
  `ResolvedAsset`, `ResolvedSurfaceDocument`, `SurfaceResolutionReason`, and
  `CanvasInches` types. `SurfaceResolutionError` is thrown when canonical
  resolution fails closed; `LegacyCopyRefFactory` is the migration callback
  type.
- `media`: `parseAssetRecord`, `validateAssetRecordShape`,
  `readAssetRecord`, `checkAssetCoverage`, and the `AssetEntry`,
  `AssetEntryId`, `AssetFinding`, `AssetRecord`, `AssetRegistryReadIssue`,
  `AssetRegistryReadIssueReason`, `AssetRegistryReadResult`, and
  `AssetCoverageReport` types. The CLI is `surface-media-check`.
- `web`: `renderWebDocument`, `buildWebHeadMetadata`,
  `listWebTemplateNames`, `AuthView`, `ErrorView`, `RenderError`, and the
  `AuthViewProps`, `ErrorViewProps`, `RenderErrorReason`, `AssetResolver`,
  `CopyResolver`, `RenderWebOptions`, `RenderWebResult`, `WebHeadMetadata`,
  `WebOpenGraphMetadata`, and `WebTwitterMetadata` types.
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
