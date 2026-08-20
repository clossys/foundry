# Changelog

## [0.6.8] - 2026-08-20

### Changed

- **Widened the `@vespeneventures/copy` dependency range to `~0.10.0`.** Same
  reason as 0.6.7 directly below, and as 0.6.5 and 0.6.4 before it: a runtime
  dependency range is shipped content, so it moves this package's version even
  though no code here changed. See
  [issue #377](https://github.com/vespeneventures/foundry/issues/377) for the
  change that required it.
- This is 0.6.8 rather than a second 0.6.7 because two independent branches each
  correctly bumped this package to 0.6.7, one widening `ui` and one widening
  `copy`. Both widenings are real and both are kept; resolving the collision by
  taking one side would have shipped 0.6.7 with a range that silently never
  widened.

## [0.6.7] - 2026-08-20

### Changed

- **Widened the `@vespeneventures/ui` dependency range to `~0.15.0`.** A runtime dependency range is shipped content, so it moves this package's version even though no code here changed. See [issue #382](https://github.com/vespeneventures/foundry/issues/382).

## [0.6.6] - 2026-08-20

### Changed

- **Widened the `@vespeneventures/ui` dependency range to `~0.14.0`.** A runtime dependency range is shipped content, so it moves this package's version even though no code here changed. See [issue #375](https://github.com/vespeneventures/foundry/issues/375).

## [0.6.5] - 2026-08-20

### Changed

- **Widened the `@vespeneventures/copy` dependency range to `~0.9.0`.** Same reason as 0.6.4: a runtime dependency range is shipped content. See [issue #379](https://github.com/vespeneventures/foundry/issues/379).

## [0.6.4] - 2026-08-20

### Changed

- **Widened the `@vespeneventures/copy` dependency range to `~0.8.0`.** A runtime dependency range is shipped content -- it sits in the published manifest and changes what a consumer resolves -- so it moves this package's version even though no code here changed. See [issue #378](https://github.com/vespeneventures/foundry/issues/378) for the change that required it.

## [0.6.3] - 2026-08-19

### Changed

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/vespeneventures/foundry/issues/273). No runtime behavior changed.

## [0.6.2] - 2026-08-17

### Changed

- Updated the `@vespeneventures/copy` dependency range from `~0.6.0` to
  `~0.7.0` so this package remains linked after copy's partial-coverage
  fix. No surface export changed.

## [0.6.1] - 2026-08-14

### Changed

- **Documented effective install behaviour on the GitHub Packages
  registry.** `react` and `react-dom` are correctly declared
  `optional: true` in `peerDependenciesMeta`, but `npm.pkg.github.com`'s
  packument omits that field entirely, so an installer resolving against
  this registry treats both as required regardless of which subpath is
  imported — including the non-web renderers (`./core`, `./media`,
  `./email`, `./print`, `./image`, `./slides`), which need neither. No
  `peerDependenciesMeta` block changed; see the README's "Requirements and
  version coupling" section and
  [issue #226](https://github.com/vespeneventures/foundry/issues/226) for
  the full evidence and decision.

## [0.6.0] - 2026-08-14

### Added

- **Media v2: responsive images and video, closing issue #177.**
  `@vespeneventures/surface/media`'s `AssetEntry` is now a discriminated
  union — `ImageAssetEntry` (`type: "image"`) or `VideoAssetEntry`
  (`type: "video"`) — where v1 had a single, image-only shape with no
  `type` field at all. `type` is REQUIRED; migrating a v1 registry means
  adding `type: "image"` to every existing entry (`schema.ts`'s new
  `"type-shape"` rule rejects an entry with none — there is no silent
  default). `ImageAssetEntry` gained an optional `sources: { src, width,
  format? }[]` for responsive `<picture>`/`srcset` output on `web`;
  omitting it degrades to the identical v1 single-`<img>` behavior.
  `VideoAssetEntry` is this package's first video support of any kind:
  `sources` (required, at least one, each with a required `mimeType`),
  `reducedMotion: "pause" | "no-autoplay" | "static-poster"` (required),
  and at least one of `captions`/`transcript` (required — enforced by the
  new `"video-caption-or-transcript-required"` schema rule, `severity:
  "error"`, so an inaccessible video can never be registered) round out the
  shape, alongside optional `poster`/`autoplay`/`loop`/`muted`.

  `licence`/`credit` are NOT new — both already existed in v1 as optional,
  shape-validated free-text fields, and stay optional here (making
  `licence` schema-required would invalidate every already-registered v1
  entry on upgrade). v1's real gap — a missing licence produced zero
  signal — closes instead via `checkAssetCoverage`'s new
  `"asset-missing-licence"` finding (`severity: "warning"`), reported for
  every registered entry, referenced or not. `AssetCoverageReport` also
  gained `registeredByType: { image: number; video: number }`; the
  existing id-matching/three-state `ok` contract is unchanged.

  `../internal/assets.ts`'s `RenderAsset` (the shared shape all five
  channel renderers paint from — deliberately not an import of
  `AssetEntry`, by design) gained the identical discriminated extension in
  parallel: `RenderImageAsset`/`RenderVideoAsset`, with `isRenderAsset`
  now dispatching to new `isRenderImageAsset`/`isRenderVideoAsset`
  predicates. Every `src`/`sources[].src`/`poster` value is scheme-checked
  (`new URL`, allowlist `https:`/`http:`, never a string match) before a
  render trusts it — a rejected value makes the whole asset `invalid`,
  never a silent drop; a value that isn't an absolute URL at all (a
  build-resolved relative path) is accepted unchanged, matching v1's own
  documented allowance. `isRenderVideoAsset` independently re-checks the
  caption-or-transcript and `reducedMotion` bars, since a hand-rolled
  `AssetLookup` can hand a renderer a value that never passed through
  `media`'s own schema.

  `web`: `renderWebDocument` now branches on `asset.type` instead of
  always emitting `<img>`. An image with no `sources` still renders the
  identical single `<img>` (regression-safe); an image WITH `sources`
  renders a `<picture>` (sources grouped by `format`, each group one
  `<source srcset="... w, ... w" type="...">`, plus a trailing fallback
  `<img>`). A video renders a real `<video controls>` with every
  `<source>`/`<track kind="captions">`, `poster`, and alt text as fallback
  content. `RenderWebOptions.prefersReducedMotion` (new, optional) is a
  caller-supplied boolean — this package has no `window`/DOM access at
  render time, so it cannot call `matchMedia` itself; a caller derives the
  value from a client hint or a direct `matchMedia` read and passes it
  through. Applied against `reducedMotion`: `"pause"`/`"no-autoplay"`
  suppress `autoplay` when active; `"static-poster"` replaces the whole
  `<video>` with a static `<img>` built from `poster`. Omitting the option
  preserves exactly today's behavior for every existing caller. Tested
  with a real `window.matchMedia("(prefers-reduced-motion: reduce)")` read
  (jsdom) feeding the option, asserted against real rendered HTML — never
  a documentation-only promise.

  `email`/`print`/`image`/`slides` (the four channels with zero video
  playback capability, by construction — a paged HTML document, an email
  client, and an SVG canvas have no `<video>`-equivalent element): a new
  shared `internal/assets.ts` helper (`toStaticRenderAsset`/
  `resolveStaticAssets`) reduces any resolved asset to the flat,
  single-image shape these four channels already paint from — an image
  reduces to itself (`sources` dropped, an explicit non-goal for these
  channels); a video reduces to its `poster`, rendered exactly like an
  image asset. A video with NO `poster` has nothing these channels can
  paint and refuses to render (`RenderError("empty-output", ...)`), the
  identical fail-closed bar an unresolved `assetId` already gets — never
  silently rendered as nothing, the exact failure mode this package has
  written down as a rule.

  README updated: new "`media` — the asset registry contract, responsive
  images, and video (v2)" section documents the discriminated shapes, the
  migration from v1, the per-channel behaviour table, the reduced-motion
  contract, and the explicit non-goals (no responsive/video support beyond
  a poster fallback on the four non-web channels, no licence
  content-validation, no automatic captioning/transcription, no video
  generation/transcoding/poster-extraction).

## [0.5.1] - 2026-08-14

### Changed

- Widened the declared `@vespeneventures/ui` dependency range from
  `~0.12.0` to `~0.13.0` to cover `ui`'s `0.13.0` minor release (its six
  optional-peer version guards, closing the remainder of issue #182 — see
  that package's own CHANGELOG). No behavior change in this package
  itself — a dependency-range bump required whenever a 0.x dependency's
  minor version moves, so this package keeps resolving `ui` as a local
  workspace link rather than falling back to a registry fetch. Follows
  `0.5.0` (the `./document` subpath below, released independently of this
  change) as the next patch.

## [0.5.0] - 2026-08-14

### Added

- New subpath `@vespeneventures/surface/document`: a product-neutral
  structured-document contract and renderer, closing issue #176.
  `StructuredDocument` (`id`, `title`, `sections`) is built from a closed,
  six-member `DocumentBlock` vocabulary (`section`, `paragraph`, `list`,
  `definition-list`, `table`, `callout`) and a two-member `DocumentInline`
  vocabulary (`text`, `link`) — every leaf of content is a `CopyRef`,
  never a literal string, the same discipline `SurfaceSlotBinding.copy`
  already holds document content to.

  `validateStructuredDocument(value): ComposeFinding[]` checks shape (a
  distinct `rule` per failure, attributed to a precise path such as
  `sections.0.blocks.2.rows.1`, the same convention the existing bindings
  validator uses), heading order (a top-level section must be `level: 2`;
  a nested section's `level` must equal its parent's `+ 1`, never equal,
  lower, or skipped ahead — `"section-level-skip"` catches the h2→h4 jump
  this contract exists to prevent; `"section-level-max-depth"` refuses a
  section nested under a `level: 6` parent, since there is no `level: 7`),
  link safety (a closed scheme allowlist — `https:`, `http:`, `mailto:` —
  mirroring `packages/auth/src/redirect.ts`'s `parseHttpUrl`; a rejected
  scheme is `"link-scheme-not-allowed"`, an error finding, never a silent
  drop; a root-relative `"/pricing"` is accepted as-is, being same-origin
  by construction, while a protocol-relative `"//host/path"` — which reads
  as same-site but resolves to the host after the `//` — is rejected as
  `"link-protocol-relative"`, and a path-relative `"docs/foo"` is rejected
  because it would resolve differently depending on which route the
  document is mounted at; an in-document `"#fragment"` link must resolve
  against a real `DocumentSection.id` present anywhere in the document,
  else
  `"link-fragment-unresolved"`), table shape (`headers` must be
  non-empty; every row must have exactly `headers.length` cells, never
  padded or truncated — `"table-row-length-mismatch"`, reported per
  offending row), and anchor uniqueness (every `DocumentSection.id` must
  be unique across the whole document, not just among siblings —
  `"section-anchor-duplicate"`, never auto-renamed or dropped to force
  uniqueness). An empty document, an empty list, and an empty table body
  are each valid, not a finding.

  `renderStructuredDocument(doc, options?)` renders to semantic HTML only
  (`<section>`, `<h2>`–`<h6>`, `<p>`, `<ul>`/`<ol>`, `<dl>`,
  `<table>`/`<thead>`/`<tbody>`/`<th>`/`<td>`, `<a>`, and
  `<aside role="note" data-callout-tone="…">` for a callout) — there is no
  `"html"` block kind and no `dangerouslySetInnerHTML` anywhere on this
  path. It refuses to render at all — throwing
  `RenderError("resolution-failed", ...)`, reusing this package's existing
  closed `RenderErrorReason` vocabulary — when `validateStructuredDocument`
  reports any error finding, or when a `CopyRef` fails to resolve during
  rendering. `doc.title` is resolved (for provenance) but never rendered
  into the output tree — the page's own `<h1>` stays the caller's job.

  Two deliberate corrections against issue #176's originally proposed
  shape, both documented in `src/document/render.ts`'s own top comment:
  `RenderStructuredDocumentOptions.resolveCopyId` is
  `@vespeneventures/copy`'s ref-based `CopyResolver`
  (`(ref: CopyRef) => CopyResolution | undefined`), not `surface/web`'s
  string-keyed one — only the ref-based resolver can produce the
  `CopyResolution[]` provenance the issue's own acceptance criteria
  require; and `renderStructuredDocument` returns
  `{ element, resolutions }` rather than a bare `ReactNode`, since a bare
  `ReactNode` has no way to carry that same `CopyResolution[]` back to the
  caller. `resolutions` feeds `collectCopyProvenance` (`surface/core`)
  unchanged, the same shape `ResolvedSurfaceDocument.resolutions` already
  produces.

  A rendered document plugs into a page through a consumer's own
  `surface/web` template's `"node"`-kind slot
  (`defineWebTemplate`/`createWebRenderer`, issue #175) — this subpath
  invents no second, parallel page-composition seam. See the README,
  "`document` — a product-neutral structured-document contract and
  renderer" for the full picture, including the non-goals (no
  legal-specific content types, no arbitrary HTML passthrough, no
  pagination, no automatic table-of-contents generation).

## [0.4.1] - 2026-08-13

### Changed

- Widened the declared `@vespeneventures/ui` dependency range from
  `~0.11.0` to `~0.12.0` to cover `ui`'s `0.12.0` minor release
  (`@vespeneventures/ui/compiled.css` — a framework-portable stylesheet for
  `atoms`; see that package's own CHANGELOG). No behavior change in this
  package itself — a dependency-range bump required whenever a 0.x
  dependency's minor version moves, so this package keeps resolving `ui`
  as a local workspace link rather than falling back to a registry fetch.

## [0.4.0] - 2026-08-13

### Added

- `web`: `defineWebTemplate` and `createWebRenderer` — an extensible,
  instance-scoped registry for a consumer's own web templates, closing
  issue #175. `defineWebTemplate(options)` validates and freezes a
  `DefineWebTemplateOptions` candidate (`name`, `flow`, optional
  `slotKinds`/`repeatingSlots`, `build`) into a real `WebTemplate`, the
  same "non-empty, unique slot keys" discipline `validateComposeDocument`
  already holds a `LayoutSpec` to, applied here at definition time instead
  of first render; a malformed `flow`, a `slotKinds` entry naming a slot
  `flow.slots` does not declare, or a `repeatingSlots` key colliding with
  a flowed slot each throw `RenderError("invalid-template-definition",
  ...)`. `createWebRenderer(options?)` returns an ISOLATED template
  registry plus the renderer bound to it — `createWebRenderer()` with no
  arguments knows zero templates, not the three built-ins;
  `includeBuiltins: true` additionally registers `AuthView`/`ErrorView`/
  `MarketingView` on that same instance; two independently created
  renderers never observe each other's templates; a duplicate `name`
  (across `templates`, and the built-ins when `includeBuiltins` is `true`)
  throws `RenderError("duplicate-template", ...)` rather than silently
  keeping the last one registered. This package exports no
  `registerWebTemplate` or other function that could mutate a shared,
  module-level map — the global-mutation alternative a consumer might
  otherwise reach for is structurally unavailable, not merely discouraged.
  The module-level `renderWebDocument`/`listWebTemplateNames` exports are
  unchanged — under the hood they are now sugar equivalent to
  `createWebRenderer({ includeBuiltins: true })`'s own methods, so every
  existing caller keeps working with a zero-line diff.

  `WebSlotContentKind` (`"copy" | "asset" | "node"`) is the new closed
  vocabulary for what a flowed slot may hold; a slot key absent from
  `WebTemplate.slotKinds` defaults to `["copy", "asset"]`, the same two
  sources `AuthView`/`ErrorView`'s existing slots have always accepted, so
  a template defined without ever mentioning `slotKinds` behaves
  identically to today. `"node"` is the new, narrow, per-slot opt-in for a
  real caller-owned `ReactNode` the caller's own trusted code already
  constructed — never a raw HTML string, never
  `dangerouslySetInnerHTML`, never audience-supplied or
  copy-registry-resolved content; React's own child-rendering already
  escapes text/attribute values by default, and a node slot's safety
  rests entirely on staying inside that path. `RenderWebOptions.nodes`
  carries a document's resolved single-binding node content into
  `renderWebDocument`/`WebRenderer.renderWebDocument`, mirroring how
  `RenderWebOptions.groups` already carries repeating-group content; a
  node for an unregistered or non-`"node"`-kind slot, or one colliding
  with a slot a `copy`/`asset` binding already filled, fails closed with
  `RenderError("resolution-failed", ...)`. Symmetrically, a `copy`/
  `assetId` binding against a slot whose declared kinds do not include
  it is refused the same way.

  `core`: `resolveSurfaceDocument` gained a third, optional parameter,
  `ResolveSurfaceDocumentOptions` (`{ nodeSlots?: Iterable<string> }`).
  Previously a single (non-repeating) `SurfaceSlotBinding` whose source
  was `node` refused UNCONDITIONALLY with
  `SurfaceResolutionError("unsupported-node", ...)`; that refusal is now
  conditional on whether the binding's `slot` is named in `nodeSlots` — an
  allowlist a caller builds from the target template's own declared
  `slotKinds` (see `web`'s `defineWebTemplate`/`WebTemplate.slotKinds`
  above), never inferred by `core` itself, which has no concept of a
  "template" of its own. Omitting `nodeSlots` (its default) preserves
  EXACTLY today's unconditional-refusal behavior — this is a purely
  additive change for every existing caller. A newly-allowed node
  resolves into the new `ResolvedSurfaceDocument.nodes` field (an array of
  `{ slot, node }`, the `ResolvedSurfaceNode` type), omitted entirely — not
  an empty array — when no such binding was authored, the identical
  convention `ResolvedSurfaceDocument.groups` already uses; it is never
  lowered into the legacy `ComposeDocument.bindings` shape, which has no
  field that could carry a `node` value at all. A `node` binding
  contributes no `CopyResolution` — it is never resolved through `CopyRef`
  — so it appears nowhere in `resolutions`/manifest copy provenance; that
  absence is documented behavior, not a gap.

## [0.3.1] - 2026-08-13

### Changed

- Widened the `@vespeneventures/copy` dependency range from `~0.5.0` to
  `~0.6.0` to cover copy's new minor release (per-entry translation
  provenance and real stale-translation detection in
  `checkLocaleCoverage` — see that package's own changelog). No code in
  this package changed; this is a version-and-range-only release, required
  by this repository's 0.x-minor-locked dependency rule (both `^` and `~`
  are minor-locked below `1.0.0`) so `check:workspace-links` keeps
  resolving `copy` as a local workspace link instead of falling back to a
  stale registry copy.

## [0.3.0] - 2026-08-13

### Added

- `web`: `MarketingView`, a new named web template closing the SECOND and
  final half of issue #166 (the flowed-marketing-template gap; repeating-
  group bindings, the first half, shipped in 0.2.0). `renderWebDocument`
  now dispatches `SurfaceDocument.template === "MarketingView"` alongside
  the existing `AuthView`/`ErrorView` — one more explicit, nameable
  template option, not a template-selection mechanism (this package still
  renders and validates; it does not compose — see the README). Composed
  entirely from already-shipped `@vespeneventures/ui` primitives:
  `SiteHeader`/`SiteFooter` (persistent chrome) and `Hero`/`FeatureGrid`/
  `Faq` (page content). Fixed, named slots: `brand` and `heroHeading` and
  `ctaHeading` are required; `heroEyebrow`/`heroDescription`/`heroActions`/
  `heroMedia`/`featuresHeading`/`featuresDescription`/`faqHeading`/
  `faqDescription`/`ctaDescription`/`ctaAction`/`footerSecondary` are
  optional flowed text/asset slots; `features` (required) and `faq`
  (optional) are repeating slots bound via `SurfaceRepeatingSlotBinding`
  and rendered through `FeatureGrid`/`Faq` respectively. An empty
  repeating group (`items: []`) renders cleanly — zero features or zero
  FAQ entries is not an error, consistent with the repeating-binding
  primitive's own "empty is a deliberate, valid choice" contract; a FAQ
  binding that was never authored at all omits the whole FAQ section,
  distinct from an explicitly-empty one. Because a repeating item carries
  exactly one resolved value (`copy`/`node`/`assetId`) but a FAQ entry
  needs two (`question` and `answer`), a `faq` item must be authored via a
  `node` shaped `{ question, answer }` — using `copy`/`assetId` there
  fails closed with `RenderError("empty-output", ...)`, the same fail-
  closed discipline `AuthView`/`ErrorView` already hold to for a missing
  required slot. `RenderWebOptions` gained `groups`, the render-time input
  a repeating slot's resolved content arrives through (mirrors
  `ResolvedSurfaceDocument.groups` — see `core`'s own 0.2.0 entry); passing
  a group for a slot a template does not declare as repeating, or omitting
  a required repeating slot entirely, both refuse the same way an unknown
  or missing single-slot binding already does
  (`RenderError("resolution-failed", ...)`). New exports:
  `MarketingView`, `MarketingViewProps`, `MarketingFeatureItem`,
  `MarketingFaqItem`. `listWebTemplateNames()` now returns `AuthView`,
  `ErrorView`, `MarketingView`.

## [0.2.1] - 2026-08-13

### Added

- **`react` peer-version guard.** `src/web/renderWebDocument.ts` — the
  canonical `./web` entry point, which already transitively covers
  `./web/internal/webTemplates.ts`'s own `react` usage — now calls
  `assertPeerVersion` (new internal `src/internal/peer-version.ts`) at
  import time, throwing a named, actionable error when the optional
  `react` peer is either not installed or installed outside this
  package's declared `>=18` range — distinct messages for each case, read
  from `react`'s own exported `version` (not a filesystem read, so this
  works whether `./web` is reached from a server or a browser bundle).
  `react-dom` has no guard: no file in this package imports it directly.
  Previously, an absent or incompatible `react` produced no signal until
  `createElement` itself crashed. See the README's "Requirements and
  version coupling" section. (#182)

## [0.2.0] - 2026-08-13

### Added

- `core`: repeating-group slot bindings, closing part of issue #166 (the
  remaining flowed-marketing-template gap is a deliberate, separate
  follow-up). A `SurfaceDocument`'s `bindings` array now additionally
  accepts a `SurfaceRepeatingSlotBinding` — the same slot key, bound to an
  ORDERED LIST of `SurfaceSlotBindingItem`s instead of a single
  `copy`/`node`/`assetId` — for content a template commits a slot to
  holding N of at run time (a capability grid, a stat band, a testimonial
  list). Each item independently obeys the same exactly-one-of-copy/node/
  assetId discipline a single binding already does, and a malformed item
  produces a finding attributed to that specific item
  (`bindings.N.items.M`), not just the slot. An explicit empty group
  (`items: []`) validates cleanly — this package cannot distinguish a
  deliberately-empty list from an upstream population failure, so it does
  not guess. `resolveSurfaceDocument` resolves a repeating binding's items
  in order onto the new `ResolvedSurfaceDocument.groups` field (omitted
  entirely, not an empty array, when a document has no repeating binding),
  and a bad item fails the whole `resolveSurfaceDocument` call — the same
  fail-closed, all-or-nothing contract a single binding's unresolved copy
  already has — with a message naming the specific item. Per-item copy
  resolutions flow into the existing `resolutions`/`collectCopyProvenance`
  path, so provenance covers a repeating-group slot per item, not just per
  slot. New exports: `SurfaceBinding`, `SurfaceRepeatingSlotBinding`,
  `SurfaceSlotBindingItem`, `isSurfaceRepeatingSlotBinding`,
  `ResolvedSurfaceGroup`, `ResolvedSurfaceGroupItem`. Fully additive: every
  existing `SurfaceSlotBinding`-only document validates and resolves
  identically to before this release — see the README, "Repeating-group
  bindings," and the pinned backward-compatibility test in
  `resolve-surface.test.ts`.

## [0.1.9] - 2026-08-13

### Changed

- Widened the `@vespeneventures/ui` range from `~0.10.0` to `~0.11.0` to
  track that package's 0.11.0 release, which adds marketing/editorial
  content blocks (`Hero`, `FeatureGrid`, `Faq`, `PricingTable`,
  `Testimonial`, `ArticleBody`) at the `./blocks` subpath. Required for the
  same reason as every prior range widening in this file: in 0.x semver a
  tilde range is minor-locked, so `~0.10.0` excluded `ui` 0.11.0 and the
  dependency stopped resolving to the sibling package. No API change here
  — this package does not use the new block exports.

## [0.1.8] - 2026-08-13

### Changed

- Widened the `@vespeneventures/ui` range from `~0.9.0` to `~0.10.0` to
  track that package's 0.10.0 release, which adds public-site chrome
  (`SkipLink`, `SiteHeader`, `NavShell`, `SiteFooter`) at the `./shell`
  subpath. Required for the same reason as every prior range widening in
  this file: in 0.x semver a tilde range is minor-locked, so `~0.9.0`
  excluded `ui` 0.10.0 and the dependency stopped resolving to the sibling
  package. No API change here — this package does not use the new shell
  exports.

## [0.1.7] - 2026-08-13

### Changed

- README now states up front that this package renders and validates but
  deliberately does not compose: there is no step that takes an intent and
  selects a template, and there will not be one. Consumers were evaluating
  this package as a replacement for a composition engine and reaching that
  conclusion only after real investigation. Documentation only — no API
  change; the boundary described is the one that already existed.

## [0.1.6] - 2026-08-13

### Changed

- Widened the `@vespeneventures/ui` range from `~0.8.0` to `~0.9.0` to track
  that package's 0.9.0 release, which promotes its WCAG colour module to
  public API and adds a checked-in contrast gate (`checkTokenContrast`,
  `ui-contrast-check`). Required for the same reason as every prior range
  widening in this file: in 0.x semver a tilde range is minor-locked, so
  `~0.8.0` excluded `ui` 0.9.0 and the dependency stopped resolving to the
  sibling package. No API change here — this package does not use the new
  contrast exports.

## [0.1.5] - 2026-08-13

### Changed

- Widened the `@vespeneventures/copy` range from `~0.4.0` to `~0.5.0` to
  track that package's 0.5.0 release (pattern rules, a third severity
  tier, channel scoping, and path exclusions for the scanning surface —
  see `copy`'s own CHANGELOG). Required for the same reason as the prior
  `copy`/`ui` widenings in this file: in 0.x semver a tilde range is
  minor-locked, so `~0.4.0` would exclude `copy` 0.5.0 and the dependency
  would stop resolving to the sibling package.

## [0.1.4] - 2026-08-13

### Changed

- Widened the `@vespeneventures/ui` range from `~0.7.0` to `~0.8.0` to track
  that package's 0.8.0 release, which adds the `theme` subpath. Required
  for the same reason as the `copy` widening in 0.1.3: in 0.x semver a
  tilde range is minor-locked, so `~0.7.0` excluded `ui` 0.8.0 and the
  dependency stopped resolving to the sibling package.
- Restored this package's `package.json` to the compact formatting every
  other package here uses. The 0.1.3 edit was made with a JSON
  pretty-printer, which expanded every single-line object and array —
  no semantic change, but it left this one manifest formatted unlike its
  siblings.

## [0.1.3] - 2026-08-13

### Changed

- Widened the `@vespeneventures/copy` range from `~0.3.0` to `~0.4.0` to
  track that package's 0.4.0 release. This is required, not cosmetic: in
  0.x semver a tilde range is minor-locked, so once `copy` reached 0.4.0
  the previous `~0.3.0` range excluded it and the dependency stopped
  resolving to the sibling package at all. No API change here — `copy`
  0.4.0 is purely additive to what this package uses.

## [0.1.2] - 2026-08-13

### Changed

- Documented the version coupling between this package and its two runtime
  dependencies: `@vespeneventures/copy` (`~0.3.0`) and
  `@vespeneventures/ui` (`~0.7.0`) are patch-only tilde ranges, not exact
  pins. This is a real constraint on the dependency graph, not an
  install-ordering concern — a package manager resolves the whole graph
  regardless of what order packages are requested in. A consumer whose own
  policy is to pin exact versions must pin `copy` to a matching `0.3.x`
  patch and `ui` to a matching `0.7.x` patch, or `surface`'s declared
  ranges and the consumer's exact pin cannot both be satisfied and the
  install fails with an unresolvable version conflict. Previously
  undocumented.

## [0.1.1] - 2026-08-13

### Fixed

- Removed the stale "Release status" caveat claiming this package "has not
  completed a public registry release." This package is already marked
  published in this repository's own lifecycle catalog — the caveat, not
  the package, was outdated. Surfaced by a consumer integration (#147).

### Changed

- Documented that a `SurfaceDocument` is exactly one canvas by design:
  `LayoutSpec`'s slots are fractional positions on a single fixed canvas,
  with no flow, no auto-height, and no array of canvases on the contract.
  A multi-page artifact is a consumer-side concern — compose an ordered
  sequence of `SurfaceDocument`s, one per page, and assemble the rendered
  results outside this package. Previously discoverable only by trial.
  Surfaced by a consumer integration (#151).

## [0.1.0] - 2026-08-12

- Consolidated the former composition, rendering, and asset-registry packages
  into `@vespeneventures/surface`.
- Added explicit `core`, `media`, and channel renderer subpaths.
- Added the canonical CopyRef-based `SurfaceDocument` contract.
- Added flowed web/email slot contracts and output manifests with optional
  structural strategy provenance.
- A `migrateComposeDocument` compatibility helper and its
  `LegacyCopyRefFactory` callback were written and then removed before this
  first release, so neither ever shipped. Consumers author `SurfaceDocument`
  directly; there is no legacy `ComposeDocument` migration path to adopt.
